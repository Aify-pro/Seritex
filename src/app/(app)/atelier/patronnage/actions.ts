"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/current-user";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import { normalizeShape, compareShapes, type Point } from "@/lib/patronnage/geometry";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — un DXF de patron est un fichier texte, largement suffisant
const ALLOWED_ROLES: ("responsable_production" | "administrateur")[] = ["responsable_production", "administrateur"];

function readDxfFile(formData: FormData): { text: string; file: File } | { error: string } {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Merci de sélectionner un fichier DXF" };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { error: "Fichier trop volumineux (10 Mo maximum)" };
  }
  return { file, text: "" };
}

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

export interface CompareRowResult {
  index: number;
  points: Point[];
  area: number;
  perimeter: number;
  best: {
    piecePatternId: string;
    pieceName: string;
    articleCode: string;
    size: string;
    referencePoints: Point[];
    confidence: number;
    areaDiffPct: number;
    perimDiffPct: number;
    shapeDiffPct: number;
  } | null;
  matchesDeclared: boolean;
  accepted: boolean;
}

export interface CompareResult {
  rows: CompareRowResult[];
  totalDetected: number;
  totalExpected: number;
  countMismatch: boolean;
  globalAccepted: boolean;
}

/**
 * Compare un tracé DXF importé à la bibliothèque de patrons. Chaque pièce
 * détectée est comparée à TOUTE la bibliothèque (pas seulement à l'article
 * déclaré) : si une pièce ressemble davantage à un autre modèle ou une autre
 * taille que ceux déclarés, c'est précisément le type d'erreur coûteuse que
 * ce module doit intercepter — jamais la laisser passer silencieusement.
 * Tolérance zéro : le tracé n'est accepté que si chaque pièce correspond au
 * patron déclaré au-dessus du seuil ET que le compte de pièces correspond.
 */
export async function compareTraceDxf(formData: FormData): Promise<CompareResult | { error: string }> {
  await requireRole(ALLOWED_ROLES);

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  const declaredArticleId = String(formData.get("article_id") ?? "").trim();
  const declaredSize = String(formData.get("size") ?? "").trim();
  const threshold = Number(formData.get("threshold") ?? 92);
  if (!declaredArticleId || !declaredSize) return { error: "Article ou taille déclaré manquant" };

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
  const { data: allPieces, error: fetchError } = await supabase
    .from("pattern_pieces")
    .select("id,name,area,perimeter,radial_signature,points,pattern_id,patterns(id,size,article_id,pattern_articles(article_code))");
  if (fetchError) return { error: `Lecture de la bibliothèque impossible : ${fetchError.message}` };
  if (!allPieces || allPieces.length === 0) {
    return { error: "La bibliothèque de patrons est vide — ajoutez au moins un patron avant de comparer." };
  }

  type RefRow = {
    id: string;
    name: string;
    area: number;
    perimeter: number;
    radial_signature: number[];
    points: Point[];
    pattern_id: string;
    patterns: { id: string; size: string; article_id: string; pattern_articles: { article_code: string } | null } | null;
  };

  const references = (allPieces as unknown as RefRow[]).filter((r) => r.patterns);

  const declaredPieces = references.filter(
    (r) => r.patterns!.article_id === declaredArticleId && r.patterns!.size === declaredSize
  );

  const rows: CompareRowResult[] = contours.map((contour, index) => {
    const candGeom = normalizeShape(contour.points);
    let best: (ReturnType<typeof compareShapes> & { ref: RefRow }) | null = null;
    for (const ref of references) {
      const cmp = compareShapes(candGeom, {
        points: ref.points,
        area: ref.area,
        perimeter: ref.perimeter,
        radial: ref.radial_signature,
      });
      if (!best || cmp.confidence > best.confidence) best = { ...cmp, ref };
    }

    const matchesDeclared = Boolean(
      best && best.ref.patterns!.article_id === declaredArticleId && best.ref.patterns!.size === declaredSize
    );
    const accepted = matchesDeclared && !!best && best.confidence >= threshold;

    return {
      index,
      points: candGeom.points,
      area: Math.round(candGeom.area),
      perimeter: Math.round(candGeom.perimeter),
      best: best
        ? {
            piecePatternId: best.ref.pattern_id,
            pieceName: best.ref.name,
            articleCode: best.ref.patterns!.pattern_articles?.article_code ?? "?",
            size: best.ref.patterns!.size,
            referencePoints: best.ref.points,
            confidence: best.confidence,
            areaDiffPct: best.areaDiffPct,
            perimDiffPct: best.perimDiffPct,
            shapeDiffPct: best.shapeDiffPct,
          }
        : null,
      matchesDeclared,
      accepted,
    };
  });

  let totalExpected = 0;
  if (declaredPieces.length > 0) {
    const { data: expectedRows } = await supabase
      .from("pattern_pieces")
      .select("expected_count")
      .in(
        "id",
        declaredPieces.map((p) => p.id)
      );
    totalExpected = (expectedRows ?? []).reduce((s, p) => s + (p.expected_count as number), 0);
  }

  const countMismatch = totalExpected > 0 && totalExpected !== contours.length;
  const globalAccepted = rows.every((r) => r.accepted) && !countMismatch;

  return { rows, totalDetected: contours.length, totalExpected, countMismatch, globalAccepted };
}
