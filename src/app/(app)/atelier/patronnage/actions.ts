"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/permissions";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import { normalizeShape, type Point } from "@/lib/patronnage/geometry";
import { loadPiecesUtilisees, loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { SEUIL_RECONNAISSANCE_DEFAUT } from "@/lib/patronnage/reconnaissance";
import { construireAnalyseDetaillee, type TraceAnalysisDetail } from "@/lib/patronnage/detail";
import { readDxfFile } from "@/lib/patronnage/upload";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export interface PreviewedPiece {
  index: number;
  layer: string;
  points: Point[];
  area: number;
  perimeter: number;
}

/**
 * Étape 1 de l'ajout d'un patron : extrait les contours fermés du DXF
 * importé sans rien enregistrer. L'utilisateur nomme ensuite chaque pièce
 * détectée (et peut en exclure) avant l'enregistrement réel — aucune
 * correspondance n'est devinée automatiquement ici.
 */
export async function previewDxfPieces(
  formData: FormData
): Promise<{ pieces: PreviewedPiece[] } | { error: string }> {
  await requirePermission("patronnage", "modify");

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  let text: string;
  try {
    text = await read.file.text();
  } catch {
    return { error: "Impossible de lire le fichier" };
  }

  const contours = parseDxfContours(text);
  if (contours.length === 0) {
    return {
      error:
        "Aucun contour exploitable détecté dans ce DXF (calques reconnus comme repères/texte exclus, ou fichier vide).",
    };
  }

  return {
    pieces: contours.map((c, index) => ({
      index,
      layer: c.layer,
      points: c.points,
      area: Math.round(polygonAreaSafe(c.points)),
      perimeter: Math.round(polygonAreaSafe(c.points, true)),
    })),
  };
}

// Évite d'exposer normalizeShape/compareShapes ici : la prévisualisation n'a besoin que
// de grandeurs simples pour affichage, pas de la signature complète.
function polygonAreaSafe(points: Point[], perimeter = false): number {
  if (perimeter) {
    let p = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      p += Math.hypot(x2 - x1, y2 - y1);
    }
    return p;
  }
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const pieceMetaSchema = z.array(
  z.object({
    index: z.number().int().min(0),
    include: z.boolean(),
    name: z.string().trim(),
    expectedCount: z.number().int().min(1).max(50),
  })
);

/**
 * Étape 2 : ré-analyse le même fichier côté serveur (jamais de confiance
 * dans une géométrie transmise par le client), applique les noms/exclusions
 * choisis par l'utilisateur, calcule la signature géométrique de chaque
 * pièce retenue, et enregistre le patron.
 */
export async function saveReferencePattern(
  formData: FormData
): Promise<{ patternId: string } | { error: string }> {
  const { authId } = await requirePermission("patronnage", "modify");

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  const size = String(formData.get("size") ?? "").trim();
  if (!size) return { error: "Taille manquante" };

  const existingArticleId = String(formData.get("existing_article_id") ?? "").trim();
  const articleCode = String(formData.get("article_code") ?? "").trim();
  const designation = String(formData.get("designation") ?? "").trim();

  const productModelId = String(formData.get("product_model_id") ?? "").trim();

  if (!existingArticleId && !articleCode) {
    return { error: "Code article manquant" };
  }
  // A5 : un nouvel article de patronnage est forcément rattaché à un modèle
  // (contrainte pattern_articles_modele_obligatoire, migration 0073).
  if (!existingArticleId && !productModelId) {
    return { error: "Choisissez le modèle de produit de ce patron" };
  }

  let piecesMeta: z.infer<typeof pieceMetaSchema>;
  try {
    piecesMeta = pieceMetaSchema.parse(JSON.parse(String(formData.get("pieces_meta") ?? "[]")));
  } catch {
    return { error: "Description des pièces invalide" };
  }
  const included = piecesMeta.filter((p) => p.include && p.name.length > 0);
  if (included.length === 0) {
    return { error: "Sélectionnez au moins une pièce à enregistrer, avec un nom" };
  }

  let text: string;
  try {
    text = await read.file.text();
  } catch {
    return { error: "Impossible de relire le fichier" };
  }
  const contours = parseDxfContours(text);

  const supabase = await createClient();

  let articleId = existingArticleId;
  if (!articleId) {
    const { data: article, error: articleError } = await supabase
      .from("pattern_articles")
      .insert({
        article_code: articleCode,
        designation: designation || "Sans désignation",
        product_model_id: productModelId,
        created_by: authId,
      })
      .select("id")
      .single();
    if (articleError) return { error: `Création de l'article impossible : ${articleError.message}` };
    articleId = article.id as string;
  }

  const { data: pattern, error: patternError } = await supabase
    .from("patterns")
    .insert({ article_id: articleId, size, created_by: authId })
    .select("id")
    .single();
  if (patternError) {
    return {
      error: patternError.code === "23505" ? `Un patron existe déjà pour cette taille sur cet article` : patternError.message,
    };
  }
  const patternId = pattern.id as string;

  const pieceRows = rowsFromContours(patternId, contours, included);

  const { error: piecesError } = await supabase.from("pattern_pieces").insert(pieceRows);
  if (piecesError) return { error: `Enregistrement des pièces impossible : ${piecesError.message}` };

  // Archivage du DXF de référence — best effort : une erreur de stockage ne doit
  // pas faire échouer l'enregistrement du patron, qui est la donnée qui compte
  // pour la reconnaissance. On journalise simplement l'échec côté serveur.
  try {
    const admin = createAdminClient();
    const remotePath = `${articleId}/${size}-${Date.now()}-${sanitizeFileName(read.file.name)}`;
    const buffer = Buffer.from(await read.file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("patronnage")
      .upload(remotePath, buffer, { contentType: "application/dxf", upsert: false });
    if (!uploadError) {
      await supabase
        .from("patterns")
        .update({ reference_dxf_path: remotePath, reference_dxf_filename: read.file.name })
        .eq("id", patternId);
    } else {
      console.error("Échec upload DXF de référence :", uploadError.message);
    }
  } catch (e) {
    console.error("Échec upload DXF de référence :", e);
  }

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "create_pattern",
    entity_type: "pattern",
    entity_id: patternId,
    metadata: { article_id: articleId, size, piece_count: pieceRows.length },
  });

  revalidatePath("/atelier/patronnage");
  return { patternId };
}

/** Lignes `pattern_pieces` d'un DXF, à partir des pièces nommées par l'utilisateur. */
function rowsFromContours(patternId: string, contours: ReturnType<typeof parseDxfContours>, included: z.infer<typeof pieceMetaSchema>) {
  return included
    .map((meta) => {
      const contour = contours[meta.index];
      if (!contour) return null;
      const geom = normalizeShape(contour.points);
      return {
        pattern_id: patternId,
        name: meta.name,
        expected_count: meta.expectedCount,
        area: geom.area,
        perimeter: geom.perimeter,
        radial_signature: geom.radial,
        points: geom.points,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

function revalidateBibliotheque() {
  revalidatePath("/atelier/patronnage");
  revalidatePath("/atelier/patronnage/bibliotheque");
}

/**
 * Mise à jour d'un patron existant (nouvelle version du modèle) : remplace les
 * pièces d'UNE taille par celles d'un nouveau DXF, même assistant que l'ajout.
 * Les nouvelles pièces sont insérées AVANT de retirer les anciennes : si
 * l'insertion échoue, le patron reste intact. Les verdicts déjà rendus sur des
 * tracés ne sont pas recalculés (ils gardent le nom du patron reconnu à
 * l'époque) ; seuls les prochains tracés analysés utilisent la nouvelle version.
 */
export async function replaceReferencePattern(formData: FormData): Promise<{ patternId: string } | { error: string }> {
  const { authId } = await requirePermission("patronnage", "modify");

  const patternId = String(formData.get("pattern_id") ?? "").trim();
  if (!patternId) return { error: "Patron manquant" };

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  let piecesMeta: z.infer<typeof pieceMetaSchema>;
  try {
    piecesMeta = pieceMetaSchema.parse(JSON.parse(String(formData.get("pieces_meta") ?? "[]")));
  } catch {
    return { error: "Description des pièces invalide" };
  }
  const included = piecesMeta.filter((p) => p.include && p.name.length > 0);
  if (included.length === 0) return { error: "Sélectionnez au moins une pièce à enregistrer, avec un nom" };

  let text: string;
  try {
    text = await read.file.text();
  } catch {
    return { error: "Impossible de relire le fichier" };
  }
  const contours = parseDxfContours(text);

  const supabase = await createClient();
  const { data: pattern } = await supabase
    .from("patterns")
    .select("id,article_id,size,reference_dxf_path")
    .eq("id", patternId)
    .maybeSingle();
  if (!pattern) return { error: "Patron introuvable" };

  const pieceRows = rowsFromContours(patternId, contours, included);
  if (pieceRows.length === 0) return { error: "Aucune pièce exploitable dans ce fichier" };

  const { data: anciennes, error: anciennesError } = await supabase.from("pattern_pieces").select("id").eq("pattern_id", patternId);
  if (anciennesError) return { error: `Lecture du patron impossible : ${anciennesError.message}` };

  const { error: insertError } = await supabase.from("pattern_pieces").insert(pieceRows);
  if (insertError) return { error: `Enregistrement des pièces impossible : ${insertError.message}` };

  const anciennesIds = (anciennes ?? []).map((a) => a.id as string);
  if (anciennesIds.length > 0) {
    const { error: deleteError } = await supabase.from("pattern_pieces").delete().in("id", anciennesIds);
    if (deleteError) {
      return { error: `Nouvelles pièces enregistrées, mais les anciennes n'ont pas pu être retirées : ${deleteError.message}. Rouvrez le patron et recommencez.` };
    }
  }

  // DXF de référence : même principe que l'ajout, best effort.
  try {
    const admin = createAdminClient();
    const remotePath = `${pattern.article_id}/${pattern.size}-${Date.now()}-${sanitizeFileName(read.file.name)}`;
    const buffer = Buffer.from(await read.file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("patronnage")
      .upload(remotePath, buffer, { contentType: "application/dxf", upsert: false });
    if (!uploadError) {
      await supabase.from("patterns").update({ reference_dxf_path: remotePath, reference_dxf_filename: read.file.name }).eq("id", patternId);
      if (pattern.reference_dxf_path) await admin.storage.from("patronnage").remove([pattern.reference_dxf_path as string]);
    } else {
      console.error("Échec upload DXF de référence :", uploadError.message);
    }
  } catch (e) {
    console.error("Échec upload DXF de référence :", e);
  }

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "update_pattern",
    entity_type: "pattern",
    entity_id: patternId,
    metadata: { article_id: pattern.article_id, size: pattern.size, piece_count: pieceRows.length, pieces_remplacees: anciennesIds.length },
  });

  revalidateBibliotheque();
  return { patternId };
}

/** Pièces de la bibliothèque (parmi `patternIds`) citées par un tracé déjà analysé. */
async function patronsUtilises(patternIds: string[]): Promise<Set<string> | { error: string }> {
  const admin = createAdminClient();
  const used = await loadPiecesUtilisees(admin);
  if (!(used instanceof Set)) return used;
  const { data, error } = await admin.from("pattern_pieces").select("id,pattern_id").in("pattern_id", patternIds);
  if (error) return { error: `Lecture des pièces impossible : ${error.message}` };
  return new Set((data ?? []).filter((p) => used.has(p.id as string)).map((p) => p.pattern_id as string));
}

/**
 * Supprime une taille d'un patron. Refusé si un tracé déjà analysé a reconnu
 * l'une de ses pièces (contrôle refait ici, côté serveur, quel que soit l'état
 * de l'écran) ; droit « Supprimer » du module requis.
 */
export async function deleteReferencePattern(patternId: string): Promise<{ error?: string }> {
  const { authId } = await requirePermission("patronnage", "delete");

  const supabase = await createClient();
  const { data: pattern } = await supabase
    .from("patterns")
    .select("id,article_id,size,reference_dxf_path")
    .eq("id", patternId)
    .maybeSingle();
  if (!pattern) return { error: "Patron introuvable" };

  const used = await patronsUtilises([patternId]);
  if (!(used instanceof Set)) return used;
  if (used.has(patternId)) return { error: "Suppression impossible : ce patron a déjà été reconnu dans des tracés." };

  const { error } = await supabase.from("patterns").delete().eq("id", patternId);
  if (error) return { error: error.message };

  if (pattern.reference_dxf_path) {
    await createAdminClient().storage.from("patronnage").remove([pattern.reference_dxf_path as string]).catch(() => undefined);
  }
  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "delete_pattern",
    entity_type: "pattern",
    entity_id: patternId,
    metadata: { article_id: pattern.article_id, size: pattern.size },
  });
  revalidateBibliotheque();
  return {};
}

/** Supprime un article de patronnage et toutes ses tailles, aux mêmes conditions que `deleteReferencePattern`. */
export async function deleteReferenceArticle(articleId: string): Promise<{ error?: string }> {
  const { authId } = await requirePermission("patronnage", "delete");

  const supabase = await createClient();
  const { data: article } = await supabase.from("pattern_articles").select("id,article_code").eq("id", articleId).maybeSingle();
  if (!article) return { error: "Article introuvable" };

  const { data: patterns } = await supabase.from("patterns").select("id,reference_dxf_path").eq("article_id", articleId);
  const ids = (patterns ?? []).map((p) => p.id as string);
  if (ids.length > 0) {
    const used = await patronsUtilises(ids);
    if (!(used instanceof Set)) return used;
    if (used.size > 0) return { error: "Suppression impossible : une taille de cet article a déjà été reconnue dans des tracés." };
  }

  const { error } = await supabase.from("pattern_articles").delete().eq("id", articleId);
  if (error) return { error: error.message };

  const paths = (patterns ?? []).map((p) => p.reference_dxf_path as string | null).filter((x): x is string => !!x);
  if (paths.length > 0) await createAdminClient().storage.from("patronnage").remove(paths).catch(() => undefined);
  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "delete_pattern_article",
    entity_type: "pattern_article",
    entity_id: articleId,
    metadata: { article_code: article.article_code, tailles: ids.length },
  });
  revalidateBibliotheque();
  return {};
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

/**
 * Analyse un tracé de placement Diamino : un seul fichier DXF contenant en
 * général de nombreuses pièces, potentiellement de plusieurs patrons, posées
 * à des rotations quelconques pour optimiser le matelas. Ce n'est PAS une
 * vérification par rapport à un article déclaré à l'avance — le module scanne
 * le tracé tel qu'il est et rapporte ce qu'il y trouve réellement.
 *
 * Pour chaque pièce détectée, la meilleure correspondance est cherchée dans
 * TOUTE la bibliothèque, sans restriction, avec une comparaison invariante en
 * rotation (cf. compareShapes). Les pièces reconnues sont regroupées et
 * comptées par patron de référence ; les pièces non reconnues sont
 * remontées individuellement avec leur meilleure piste, jamais masquées.
 *
 * Seuil de reconnaissance élevé par défaut (98%, pas 92%) : un tracé Diamino
 * est une copie numérique directe du patron de référence, pas un nouveau
 * relevé manuel — une pièce correcte doit donc correspondre presque
 * exactement (aux imprécisions de flottants près), pas "à peu près". Un
 * score proche de 92% signale une vraie divergence (mauvaise taille, mauvais
 * modèle), pas une simple tolérance de mesure à absorber.
 *
 * Résultat exploité tel quel par l'écran : le tracé n'est considéré bon que
 * si `allRecognized` est vrai, c'est-à-dire que 100% des pièces posées ont
 * été reconnues — jamais un score de confiance individuel utilisé comme
 * seuil de validation globale.
 *
 * Cette action est l'outil d'analyse ponctuel (hors fiche). Elle appelle
 * EXACTEMENT le même moteur que l'upload d'un tracé dans une fiche
 * (`reconnaitreTrace`) : deux verdicts divergents sur le même fichier selon
 * le point d'entrée seraient un défaut de fiabilité du contrôle.
 */
export async function analyzeTraceDxf(formData: FormData): Promise<TraceAnalysisDetail | { error: string }> {
  await requirePermission("patronnage", "modify");

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  const rawThreshold = Number(formData.get("threshold") ?? SEUIL_RECONNAISSANCE_DEFAUT);
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 100
      ? rawThreshold
      : SEUIL_RECONNAISSANCE_DEFAUT;

  let text: string;
  try {
    text = await read.file.text();
  } catch {
    return { error: "Impossible de lire le fichier" };
  }
  const contours = parseDxfContours(text);
  if (contours.length === 0) {
    return { error: "Aucun contour exploitable détecté dans ce tracé." };
  }

  const supabase = await createClient();
  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return { error: library.error };

  return construireAnalyseDetaillee(contours, library.references, threshold);
}
