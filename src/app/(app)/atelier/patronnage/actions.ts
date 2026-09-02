"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/current-user";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import {
  normalizeShape,
  compareShapes,
  appliquerEchelleFichier,
  type Point,
} from "@/lib/patronnage/geometry";
import { loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { reconnaitreTrace, SEUIL_RECONNAISSANCE_DEFAUT } from "@/lib/patronnage/reconnaissance";
import { readDxfFile } from "@/lib/patronnage/upload";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ALLOWED_ROLES: ("responsable_production" | "administrateur")[] = ["responsable_production", "administrateur"];

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
  await requireRole(ALLOWED_ROLES);

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
  const { authId } = await requireRole(ALLOWED_ROLES);

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  const size = String(formData.get("size") ?? "").trim();
  if (!size) return { error: "Taille manquante" };

  const existingArticleId = String(formData.get("existing_article_id") ?? "").trim();
  const articleCode = String(formData.get("article_code") ?? "").trim();
  const designation = String(formData.get("designation") ?? "").trim();

  if (!existingArticleId && !articleCode) {
    return { error: "Code article manquant" };
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
      .insert({ article_code: articleCode, designation: designation || "Sans désignation", created_by: authId })
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

  const pieceRows = included
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

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

export interface RecognizedGroup {
  patternPieceId: string;
  articleCode: string;
  size: string;
  pieceName: string;
  count: number;
  /** Sous-ensemble de `count` reconnu via la passe miroir — alerte, non bloquant. */
  mirroredCount: number;
  referencePoints: Point[];
  exampleCandidatePoints: Point[];
}

export interface UnrecognizedPiece {
  index: number;
  points: Point[];
  area: number;
  perimeter: number;
  bestGuess: {
    articleCode: string;
    size: string;
    pieceName: string;
    referencePoints: Point[];
    confidence: number;
    areaDiffPct: number;
    perimDiffPct: number;
    shapeDiffPct: number;
  } | null;
}

export interface TraceAnalysis {
  totalDetected: number;
  recognized: RecognizedGroup[];
  unrecognized: UnrecognizedPiece[];
  allRecognized: boolean;
  /** Facteur d'échelle fichier appliqué (1 = aucune correction). */
  scaleFactor: number;
  mirrorAlert: boolean;
  scaleAlert: boolean;
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
export async function analyzeTraceDxf(formData: FormData): Promise<TraceAnalysis | { error: string }> {
  await requireRole(ALLOWED_ROLES);

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

  const analyse = reconnaitreTrace(contours, library.references, threshold);

  // Géométries d'aperçu : reconstruites à l'échelle corrigée, pour que le
  // rendu SVG superpose bien candidat et référence même quand le fichier
  // était exporté dans une mauvaise unité.
  const corrected = appliquerEchelleFichier(
    contours.map((c) => c.points),
    analyse.facteurEchelle
  );
  const byId = new Map(library.references.map((r) => [r.id, r]));

  const recognized: RecognizedGroup[] = analyse.patronsReconnus.map((g) => {
    const ref = byId.get(g.patron_id);
    const exempleIndex = analyse.exempleParPatron[g.patron_id];
    const exemple = exempleIndex !== undefined ? corrected[exempleIndex] : undefined;
    return {
      patternPieceId: g.patron_id,
      articleCode: g.article,
      size: g.taille,
      pieceName: g.piece,
      count: g.quantite,
      mirroredCount: g.dont_en_miroir,
      referencePoints: ref?.geom.points ?? [],
      exampleCandidatePoints: exemple ? normalizeShape(exemple).points : [],
    };
  });

  const unrecognized: UnrecognizedPiece[] = analyse.piecesNonReconnues.map((p) => {
    const geom = normalizeShape(corrected[p.index_piece]);
    const candidat = p.meilleur_candidat;
    const ref = candidat ? byId.get(candidat.patron_id) : undefined;
    // Détail des écarts recalculé pour l'affichage ; le score de confiance
    // affiché reste celui retenu par le moteur (source unique du verdict).
    const detail = ref ? compareShapes(geom, ref.geom) : null;
    return {
      index: p.index_piece,
      points: geom.points,
      area: Math.round(geom.area),
      perimeter: Math.round(geom.perimeter),
      bestGuess:
        candidat && ref && detail
          ? {
              articleCode: candidat.article,
              size: candidat.taille,
              pieceName: candidat.piece,
              referencePoints: ref.geom.points,
              confidence: p.meilleur_score,
              areaDiffPct: detail.areaDiffPct,
              perimDiffPct: detail.perimDiffPct,
              shapeDiffPct: detail.shapeDiffPct,
            }
          : null,
    };
  });

  return {
    totalDetected: analyse.nbPiecesDetectees,
    recognized,
    unrecognized,
    allRecognized: analyse.reconnaissanceComplete,
    scaleFactor: analyse.facteurEchelle,
    mirrorAlert: analyse.alerteMiroir,
    scaleAlert: analyse.alerteEchelle,
  };
}
