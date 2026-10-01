import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Size } from "@/lib/sizes";
import type { DispatchRule } from "@/lib/dispatching";

/**
 * Tailles proposables par modèle de produit, pour le dispatching d'un devis
 * (migration 0066) : la disponibilité déclarée du modèle, ou tout le
 * référentiel actif s'il n'en déclare aucune (convention 0029), dans l'ordre
 * métier (groupe puis position).
 *
 * Lecture avec le client d'administration : le référentiel de tailles n'est
 * lisible que par le staff, or le client doit pouvoir ajuster la répartition
 * de son devis. Ce sont des données de référence, sans rien de confidentiel ;
 * l'appelant a déjà contrôlé l'accès au devis.
 */
export async function getSizeOptionsByModel(modelIds: (string | null)[]): Promise<Record<string, Size[]>> {
  const ids = [...new Set(modelIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return {};
  const admin = createAdminClient();
  const [{ data: sizes }, { data: restrictions }] = await Promise.all([
    admin.from("sizes").select("id,groupe,libelle,cle").eq("active", true).order("groupe").order("display_order"),
    admin.from("product_model_sizes").select("product_model_id,size_id").in("product_model_id", ids),
  ]);
  const all = (sizes ?? []) as Size[];
  const out: Record<string, Size[]> = {};
  for (const id of ids) {
    const retenues = new Set((restrictions ?? []).filter((r) => r.product_model_id === id).map((r) => r.size_id as string));
    out[id] = retenues.size === 0 ? all : all.filter((s) => retenues.has(s.id));
  }
  return out;
}

/** Règles de dispatching (Paramètres > Dispatching), sous la forme du calcul — lisibles par le staff (RLS). */
export async function getDispatchRules(): Promise<DispatchRule[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dispatch_rules")
    .select("id,groupe,qty_min,qty_max,dispatch_rule_sizes(taille,pct)")
    .order("groupe")
    .order("qty_min");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    groupe: r.groupe as string,
    qtyMin: r.qty_min as number,
    qtyMax: (r.qty_max as number | null) ?? null,
    pcts: Object.fromEntries(((r.dispatch_rule_sizes ?? []) as { taille: string; pct: number }[]).map((s) => [s.taille, Number(s.pct)])),
  }));
}
