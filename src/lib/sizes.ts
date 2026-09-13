import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Une taille du référentiel (migration 0029, peuplé par 0030).
 *
 * `cle` — « Groupe/Libellé » — est la seule valeur qui circule dans le reste
 * du schéma : colonne `production_order_sizes.taille`, et clés JSON des
 * répartitions du patronnage. Le libellé seul ne suffirait pas, un « M »
 * homme et un « M » femme étant deux tailles distinctes.
 */
export type Size = { id: string; groupe: string; libelle: string; cle: string };

/**
 * Tailles actives, dans l'ordre métier (groupe puis position saisie — jamais
 * alphabétique : XS vient avant S). Mise en cache par requête serveur, comme
 * la matrice de permissions : une page qui l'appelle pour plusieurs
 * composants ne paie qu'un aller-retour.
 */
export const getSizes = cache(async (): Promise<Size[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sizes")
    .select("id,groupe,libelle,cle")
    .eq("active", true)
    .order("groupe")
    .order("display_order");
  return (data ?? []) as Size[];
});

/**
 * Tailles proposables pour un modèle donné : sa disponibilité déclarée, ou
 * tout le référentiel si aucune restriction ne l'est. Cette convention est
 * celle de la migration 0029 — sans elle, activer le référentiel rendrait
 * d'un coup tous les modèles existants incomplets.
 */
export async function getSizesForProductModel(productModelId: string | null): Promise<Size[]> {
  const all = await getSizes();
  if (!productModelId) return all;

  const supabase = await createClient();
  const { data } = await supabase
    .from("product_model_sizes")
    .select("size_id")
    .eq("product_model_id", productModelId);

  const retenues = new Set((data ?? []).map((r) => r.size_id as string));
  if (retenues.size === 0) return all;
  return all.filter((s) => retenues.has(s.id));
}

/** Ordonne les clés d'une répartition selon le référentiel, et écarte les quantités nulles. */
export function orderedRepartition(
  repartition: Record<string, number> | null | undefined,
  sizes: Size[]
): { cle: string; libelle: string; groupe: string; quantite: number }[] {
  if (!repartition) return [];
  return sizes
    .filter((s) => (repartition[s.cle] ?? 0) > 0)
    .map((s) => ({ cle: s.cle, libelle: s.libelle, groupe: s.groupe, quantite: repartition[s.cle] }));
}
