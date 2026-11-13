import "server-only";
import { createClient } from "@/lib/supabase/server";
import { removeTraceFiles, storeTraceFile } from "@/lib/storage/patronnage-files";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import { loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { reconnaitreTrace } from "@/lib/patronnage/reconnaissance";
import { MM_PAR_UNITE } from "@/lib/patronnage/detail";

/**
 * Dépôt du fichier DXF d'un tracé : UN seul chemin, que le fichier vienne de
 * Modaris / Diamino (dépôt à la main) ou du calcul d'imbrication de Seritex.
 * Reconnaissance des pièces, stockage, dimensions, analyse, passage de la
 * fiche en « Tracés déposés » et journal : tout ce qui suit (marquage, PDF,
 * rouleaux, matelas, validation) ne voit donc aucune différence entre les
 * deux origines — c'est ce qui garde le calcul automatique FACULTATIF.
 *
 * Les droits et l'état du tracé (en préparation, fiche ouverte) sont
 * vérifiés par l'appelant, avant.
 */

export const MOTEUR_VERSION = "patronnage-v2 (rotation+180°, échelle, miroir)";
export const SEUIL_RECONNAISSANCE = 98;

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface FichierTrace {
  texte: string;
  nom: string;
  octets: Buffer;
}

export interface OptionsDepot {
  /** Statut de la fiche avant le dépôt (passage auto en « traces_deposes »). */
  statutFiche: string;
  /** Colonnes du tracé à écrire en plus (ex. laize retenue par le calcul). */
  complementTrace?: Record<string, unknown>;
  /** Détails ajoutés au journal. */
  journal?: { action: string; metadata?: Record<string, unknown> };
}

export async function deposerFichierTrace(
  supabase: Supabase,
  authId: string,
  traceId: string,
  ficheId: string,
  fichier: FichierTrace,
  options: OptionsDepot
): Promise<{ reconnaissanceComplete: boolean } | { error: string }> {
  const contours = parseDxfContours(fichier.texte);
  if (contours.length === 0) {
    return { error: "Aucun contour exploitable détecté dans ce tracé." };
  }

  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return { error: library.error };

  // Moteur : pré-passe d'échelle fichier, comparaison directe contre toute la
  // bibliothèque, puis passe miroir (cf. lib/patronnage/reconnaissance).
  const analyse = reconnaitreTrace(contours, library.references, SEUIL_RECONNAISSANCE);

  // Stockage du fichier (remplace l'ancien s'il existe)
  const { data: existingTrace } = await supabase.from("traces_placement").select("fichier_path").eq("id", traceId).single();
  if (existingTrace?.fichier_path) {
    await removeTraceFiles([existingTrace.fichier_path]);
  }
  const stored = await storeTraceFile(`traces/${ficheId}/${traceId}-${Date.now()}-${sanitizeFileName(fichier.nom)}`, fichier.octets);
  if ("error" in stored) return { error: `Échec de l'enregistrement du fichier : ${stored.error}` };
  const remotePath = stored.path;

  // Dimensions du tracé lues dans le fichier (encombrement du placement, à
  // l'échelle retenue par la reconnaissance) : la plus grande est la longueur
  // du matelas, l'autre sa largeur. Modifiables ensuite à la main.
  const dims = dimensionsTraceCm(
    contours.map((c) => c.points),
    analyse.facteurEchelle
  );

  const { data: traceUpdated, error: traceUpdateError } = await supabase
    .from("traces_placement")
    .update({
      ...(dims ? { longueur_matelas_cm: dims.longueur, largeur_matelas_cm: dims.largeur } : {}),
      fichier_path: remotePath,
      fichier_nom: fichier.nom,
      fichier_taille: fichier.octets.length,
      charge_par: authId,
      charge_le: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(options.complementTrace ?? {}),
    })
    .eq("id", traceId)
    .select("id");
  if (traceUpdateError) {
    await removeTraceFiles([remotePath]);
    return { error: traceUpdateError.message };
  }
  // La RLS filtre sans erreur : 0 ligne modifiée = dépôt non pris en compte.
  // On retire le fichier tout juste stocké plutôt que de laisser un orphelin,
  // et surtout on ne prétend pas que le dépôt a réussi.
  if (!traceUpdated?.length) {
    await removeTraceFiles([remotePath]);
    return { error: "La base a refusé la mise à jour du tracé (droits ou verrou de l'ODF) — aucune modification n'a été enregistrée." };
  }

  const analyseError = await persisterAnalyse(supabase, traceId, analyse);
  if (analyseError) return { error: analyseError };

  // Fiche : passage automatique en "Tracés déposés" au premier dépôt
  if (options.statutFiche === "demande") {
    await supabase.from("fiches_placement").update({ statut: "traces_deposes" }).eq("id", ficheId);
  }

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: options.journal?.action ?? "upload_trace_dxf",
    entity_type: "trace_placement",
    entity_id: traceId,
    metadata: {
      nb_pieces: analyse.nbPiecesDetectees,
      facteur_echelle: analyse.facteurEchelle,
      score_echelle: analyse.scoreEchelle,
      taux_reconnaissance: analyse.tauxReconnaissance,
      alerte_miroir: analyse.alerteMiroir,
      reconnaissance_complete: analyse.reconnaissanceComplete,
      ...(options.journal?.metadata ?? {}),
    },
  });

  return { reconnaissanceComplete: analyse.reconnaissanceComplete };
}

/** Enregistre (ou remplace) l'analyse d'un tracé. Retourne le message d'erreur éventuel. */
export async function persisterAnalyse(supabase: Supabase, traceId: string, analyse: ReturnType<typeof reconnaitreTrace>): Promise<string | null> {
  const { error } = await supabase.from("analyses_trace").upsert(
    {
      trace_id: traceId,
      nb_pieces_detectees: analyse.nbPiecesDetectees,
      facteur_echelle: analyse.facteurEchelle,
      patrons_reconnus: analyse.patronsReconnus,
      pieces_non_reconnues: analyse.piecesNonReconnues,
      taux_reconnaissance: analyse.tauxReconnaissance,
      reconnaissance_complete: analyse.reconnaissanceComplete,
      alerte_miroir: analyse.alerteMiroir,
      alerte_echelle: analyse.alerteEchelle,
      moteur_version: MOTEUR_VERSION,
      analysee_le: new Date().toISOString(),
    },
    { onConflict: "trace_id" }
  );
  if (error) return error.message;
  // Tracé d'un ordre regroupé sans pièces : le fichier les pré-remplit (D2) ;
  // la saisie manuelle reste possible et rien n'est jamais écrasé ici.
  const { data: t } = await supabase.from("traces_placement").select("fiches_placement(regroupee),trace_semi_finis(id)").eq("id", traceId).maybeSingle();
  const fiche = Array.isArray(t?.fiches_placement) ? t?.fiches_placement[0] : t?.fiches_placement;
  if (fiche?.regroupee && (t?.trace_semi_finis ?? []).length === 0) {
    await supabase.rpc("pre_remplir_pieces_trace", { p_trace_id: traceId });
  }
  return null;
}

/** Encombrement du placement en centimètres (unité de fichier × échelle × 0,1 mm). */
function dimensionsTraceCm(pieces: [number, number][][], facteur: number): { longueur: number; largeur: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pieces) {
    for (const [x, y] of p) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const cm = (v: number) => Math.round(((v * facteur * MM_PAR_UNITE) / 10) * 10) / 10;
  const a = cm(maxX - minX);
  const b = cm(maxY - minY);
  if (a <= 0 || b <= 0) return null;
  return { longueur: Math.max(a, b), largeur: Math.min(a, b) };
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}
