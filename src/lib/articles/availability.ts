import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Disponibilité des articles d'après les rouleaux de tissu en stock
 * (migration 0107, `article_availability`). `non_suivi` : le suivi n'est pas
 * activé sur ce grammage — on ne sait pas, rien n'est signalé.
 */
export type AvailabilityStatus = "disponible" | "indisponible" | "non_suivi";

export interface AvailabilityRow {
  model_id: string;
  textile_id: string;
  grammage: number | null;
  color_id: string;
  color_name: string;
  suivi: boolean;
  rouleaux: number;
  kg: number;
  statut: AvailabilityStatus;
}

/** Statut d'un article entier : tous ses (grammage × couleur) suivis. */
export type ArticleAvailability = "disponible" | "partiel" | "indisponible" | "non_suivi";

/**
 * Mention à afficher sur le site (e-shop) à la place d'un article ou d'une
 * couleur indisponible. Le site ne propose que ce qui est disponible.
 */
export const ESHOP_UNAVAILABLE_MESSAGE = "Indisponible actuellement — contactez notre service commercial.";

export async function getArticleAvailability(modelIds: string[]): Promise<AvailabilityRow[]> {
  if (modelIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("article_availability", { p_model_ids: modelIds });
  // Une panne de l'outil de disponibilité ne doit jamais empêcher de faire une demande ou un devis.
  if (error || !data) return [];
  return (data as AvailabilityRow[]).map((r) => ({ ...r, grammage: r.grammage == null ? null : Number(r.grammage), kg: Number(r.kg) }));
}

export function groupByModel(rows: AvailabilityRow[]): Map<string, AvailabilityRow[]> {
  const byModel = new Map<string, AvailabilityRow[]>();
  for (const r of rows) byModel.set(r.model_id, [...(byModel.get(r.model_id) ?? []), r]);
  return byModel;
}

export function summarizeArticle(rows: AvailabilityRow[]): ArticleAvailability {
  const suivies = rows.filter((r) => r.statut !== "non_suivi");
  if (suivies.length === 0) return "non_suivi";
  const manquantes = suivies.filter((r) => r.statut === "indisponible").length;
  if (manquantes === 0) return "disponible";
  return manquantes === suivies.length ? "indisponible" : "partiel";
}

const gram = (g: number | null) => (g == null ? "tissu" : `${g} g/m²`);

/**
 * Couleurs d'un article dont le tissu manque, avec la raison à afficher
 * (« 125 g/m² : plus de rouleau »). Une couleur n'est signalée que si TOUS
 * les grammages suivis que l'article peut utiliser lui manquent.
 */
export function unavailableColors(rows: AvailabilityRow[]): Map<string, { name: string; reason: string }> {
  const byColor = new Map<string, AvailabilityRow[]>();
  for (const r of rows) byColor.set(r.color_id, [...(byColor.get(r.color_id) ?? []), r]);
  const out = new Map<string, { name: string; reason: string }>();
  for (const [colorId, list] of byColor) {
    const suivies = list.filter((r) => r.statut !== "non_suivi");
    if (suivies.length === 0 || suivies.some((r) => r.statut === "disponible")) continue;
    // Un grammage « non suivi » reste une inconnue : on ne conclut pas à l'indisponibilité.
    if (list.some((r) => r.statut === "non_suivi")) continue;
    out.set(colorId, {
      name: list[0].color_name,
      reason: `${[...new Set(suivies.map((r) => gram(r.grammage)))].join(", ")} : plus de rouleau en stock`,
    });
  }
  return out;
}

/** Pour les écrans de saisie : article → couleur → raison (seulement les couleurs indisponibles). */
export function colorAlertsByModel(rows: AvailabilityRow[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [modelId, list] of groupByModel(rows)) {
    const alerts = unavailableColors(list);
    if (alerts.size) out[modelId] = Object.fromEntries([...alerts].map(([id, a]) => [id, a.reason]));
  }
  return out;
}
