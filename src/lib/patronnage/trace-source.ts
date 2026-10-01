import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readTraceFile } from "@/lib/storage/patronnage-files";
import { parseDxfContours, type DxfContour } from "@/lib/patronnage/dxf";
import { FACTEURS_ECHELLE, type FacteurEchelle } from "@/lib/patronnage/geometry";

/**
 * Chargement d'un tracé déjà déposé — DXF brut (pour le marquage et le
 * téléchargement tel que déposé) ET contours déjà analysés (pour le moteur).
 * Un seul endroit qui sait relire un tracé stocké : partagé par les actions
 * serveur (détail, apprentissage, ré-analyse) ET par les routes de
 * téléchargement (`/api/patronnage/traces/[id]/dxf*`) — jamais deux
 * implémentations qui pourraient diverger sur ce qu'« un tracé déposé »
 * signifie.
 */
export interface TraceSource {
  texte: string;
  contours: DxfContour[];
  fichierNom: string;
}

export async function chargerTraceSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  traceId: string,
  ficheId: string
): Promise<TraceSource | { error: string }> {
  const { data: trace, error } = await supabase
    .from("traces_placement")
    .select("fiche_id,fichier_path,fichier_nom")
    .eq("id", traceId)
    .single();
  if (error || !trace || trace.fiche_id !== ficheId) return { error: "Tracé introuvable" };
  if (!trace.fichier_path) return { error: "Aucun fichier déposé pour ce tracé." };

  const stored = await readTraceFile(trace.fichier_path);
  if (!stored) return { error: "Impossible de relire le fichier déposé." };

  let texte: string;
  try {
    texte = stored.toString("utf-8");
  } catch {
    return { error: "Impossible de lire le fichier déposé." };
  }
  const contours = parseDxfContours(texte);
  if (contours.length === 0) {
    return { error: "Aucun contour exploitable détecté dans ce tracé." };
  }
  return { texte, contours, fichierNom: (trace.fichier_nom as string | null) ?? "trace.dxf" };
}

/**
 * Facteur d'échelle de la dernière analyse enregistrée du tracé, ou
 * `undefined` s'il n'y en a pas. Le détail, l'apprentissage, la ré-analyse ET
 * le marquage repartent de CE facteur (auto-détecté au dépôt, ou choisi à la
 * main) : sinon un ratio choisi manuellement serait perdu à la relecture, et
 * l'écran (ou le fichier marqué) montrerait autre chose que ce qui a été
 * enregistré. Pour relancer la détection automatique, il faut le demander
 * explicitement (`reanalyserTrace`).
 */
export async function facteurEnregistreTrace(
  supabase: Awaited<ReturnType<typeof createClient>>,
  traceId: string
): Promise<FacteurEchelle | undefined> {
  const { data } = await supabase.from("analyses_trace").select("facteur_echelle").eq("trace_id", traceId).maybeSingle();
  const f = Number(data?.facteur_echelle);
  return (FACTEURS_ECHELLE as readonly number[]).includes(f) ? (f as FacteurEchelle) : undefined;
}
