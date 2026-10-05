import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Article demandé (modèle, couleur, quantités par taille) — le même pour une
 * demande client et une demande pour le stock, et demain pour une demande
 * faite par le client depuis l'e-shop. Stocké dans requests.lignes_stock
 * (nom hérité de SF-3) ; reprend les lignes du devis à l'ouverture.
 */
export type RequestArticleLine = {
  product_model_id: string;
  description: string;
  couleur_unique_id: string | null;
  tailles: Record<string, number>;
};

export interface RequestModelOption {
  id: string;
  name: string;
  colors: { id: string; name: string }[];
  sizes: { cle: string; libelle: string }[];
}

/** Modèles proposables dans une demande, avec leurs couleurs et tailles. */
export async function getRequestModelOptions(): Promise<RequestModelOption[]> {
  const supabase = await createClient();
  const [{ data: models }, { data: modelColors }, { data: modelSizes }, { data: sizes }] = await Promise.all([
    // Produits finis seulement, tant que la vente des autres articles n'a pas son circuit.
    supabase.from("product_models").select("id,name").eq("active", true).eq("nature", "pf").order("name"),
    supabase.from("product_model_colors").select("product_model_id,colors(id,name)"),
    supabase.from("product_model_sizes").select("product_model_id,sizes(cle,libelle,groupe,display_order)"),
    supabase.from("sizes").select("cle,libelle,groupe,display_order").eq("active", true).order("groupe").order("display_order"),
  ]);
  return (models ?? []).map((m) => {
    const ownSizes = (modelSizes ?? [])
      .filter((s) => s.product_model_id === m.id)
      .map((s) => s.sizes as unknown as { cle: string; libelle: string; groupe: string; display_order: number })
      .sort((a, b) => a.groupe.localeCompare(b.groupe) || a.display_order - b.display_order);
    return {
      id: m.id as string,
      name: m.name as string,
      colors: (modelColors ?? []).filter((c) => c.product_model_id === m.id).map((c) => c.colors as unknown as { id: string; name: string }),
      sizes: (ownSizes.length ? ownSizes : (sizes ?? [])).map((s) => ({ cle: s.cle as string, libelle: s.libelle as string })),
    };
  });
}

/** Lignes valides d'une saisie : un modèle choisi ; quantités nulles retirées. */
export function cleanRequestLines(lines: RequestArticleLine[]): RequestArticleLine[] {
  return lines
    .filter((l) => l.product_model_id)
    .map((l) => ({
      ...l,
      tailles: Object.fromEntries(Object.entries(l.tailles ?? {}).filter(([, q]) => Number.isInteger(q) && q > 0)),
    }));
}
