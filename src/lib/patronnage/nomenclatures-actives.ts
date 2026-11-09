import type { createClient } from "@/lib/supabase/server";

/**
 * Nomenclatures réellement utilisées par des lignes d'ODF (0161) : celles vers
 * lesquelles une quantité est basculée, et la principale tant qu'il lui reste
 * une quantité. Même règle que nomenclatures_ligne() en base.
 */
export async function nomenclaturesActives(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lignes: { id: string; modele: string | null }[]
): Promise<Map<string, string[]>> {
  const actives = new Map<string, string[]>();
  const avecModele = lignes.filter((l): l is { id: string; modele: string } => !!l.modele);
  if (avecModele.length === 0) return actives;
  const lineIds = avecModele.map((l) => l.id);
  const [{ data: principales }, { data: bascules }, { data: tailles }] = await Promise.all([
    supabase.from("nomenclatures").select("id,product_model_id").eq("principale", true).in("product_model_id", [...new Set(avecModele.map((l) => l.modele))]),
    supabase.from("production_order_line_nomenclatures").select("production_order_line_id,nomenclature_id,taille,quantite").in("production_order_line_id", lineIds),
    supabase.from("production_order_sizes").select("production_order_line_id,taille,quantite_demandee").in("production_order_line_id", lineIds),
  ]);
  for (const l of avecModele) {
    const lesBascules = (bascules ?? []).filter((b) => b.production_order_line_id === l.id);
    const ids = new Set(lesBascules.map((b) => b.nomenclature_id as string));
    const resteSurPrincipale = (tailles ?? []).some(
      (t) =>
        t.production_order_line_id === l.id &&
        Number(t.quantite_demandee) > lesBascules.filter((b) => b.taille === t.taille).reduce((s, b) => s + Number(b.quantite), 0)
    );
    const principale = (principales ?? []).find((n) => n.product_model_id === l.modele)?.id as string | undefined;
    if (principale && resteSurPrincipale) ids.add(principale);
    actives.set(l.id, [...ids]);
  }
  return actives;
}
