import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouleauTrace, RouleauxTrace } from "@/app/(app)/atelier/patronnage/fiches-actions";

/**
 * Rouleaux en stock et rouleaux déjà choisis pour un tracé (0163). Le client
 * est fourni par l'appelant : session de la personne (écran) ou serveur au
 * nom du propriétaire d'un agent IA (les réservations sont alors lues au nom
 * de ce propriétaire).
 */
export async function rouleauxDuTrace(
  supabase: SupabaseClient,
  traceId: string,
  lireReservations: () => Promise<unknown[]>
): Promise<RouleauxTrace | { error: string }> {
  const colonnes = "id,code,forme,textile_id,variant_id,laize_cm,poids_kg,bain,colors(name),textiles(nom,grammage)";
  const [{ data: trace }, { data: choisis }, { data: stock, error }, reservations, { data: couches }, { data: prevus }] = await Promise.all([
    supabase.from("traces_placement").select("fiche_id").eq("id", traceId).maybeSingle(),
    supabase.from("trace_rouleaux").select(`roll_id,textile_rolls(${colonnes})`).eq("trace_id", traceId),
    supabase.from("textile_rolls").select(colonnes).eq("statut", "en_stock").gt("poids_kg", 0).order("recu_le", { ascending: false }).limit(500),
    lireReservations(),
    supabase.from("trace_couches").select("production_order_line_id").eq("trace_id", traceId),
    supabase.from("trace_tissus").select("variant_id").eq("trace_id", traceId),
  ]);
  if (error) return { error: error.message };
  type Roll = { id: string; code: string; forme: string; textile_id: string; variant_id: string | null; laize_cm: number | null; poids_kg: number; bain: string | null; colors: { name: string } | null; textiles: { nom: string; grammage: number | null } | null };
  const dejaChoisis = (choisis ?? []).map((c) => c.textile_rolls as unknown as Roll).filter(Boolean);
  const idsChoisis = new Set(dejaChoisis.map((r) => r.id));
  const reservation = new Map(
    ((reservations ?? []) as { roll_id: string; trace_id: string; odfs: string[] }[]).filter((r) => r.trace_id !== traceId).map((r) => [r.roll_id, r.odfs.join(", ")])
  );
  const { data: groupe } = trace ? await supabase.from("coupe_groupee_lignes").select("production_order_line_id").eq("fiche_id", trace.fiche_id) : { data: [] };
  const lineIds = [...new Set([...(couches ?? []), ...(groupe ?? [])].map((l) => l.production_order_line_id as string))];
  const { data: lignes } = lineIds.length ? await supabase.from("production_order_lines").select("textile_id,product_models(textile_id)").in("id", lineIds) : { data: [] };
  const textilesTrace = [
    ...new Set(
      ((lignes ?? []) as unknown as { textile_id: string | null; product_models: { textile_id: string | null } | null }[])
        .map((l) => l.textile_id ?? l.product_models?.textile_id ?? null)
        .filter((t): t is string => !!t)
    ),
  ];
  const versLigne = (r: Roll, choisi: boolean): RouleauTrace => ({
    code: r.code,
    forme: r.forme,
    textileId: r.textile_id,
    variantId: r.variant_id,
    tissu: `${r.textiles?.nom ?? "—"}${r.textiles?.grammage ? ` ${r.textiles.grammage} g` : ""}`,
    couleur: r.colors?.name ?? null,
    laizeCm: r.laize_cm != null ? Number(r.laize_cm) : null,
    poidsKg: Number(r.poids_kg),
    bain: r.bain,
    choisi,
    reservation: reservation.get(r.id) ?? null,
  });
  return {
    rouleaux: [...dejaChoisis.map((r) => versLigne(r, true)), ...((stock ?? []) as unknown as Roll[]).filter((r) => !idsChoisis.has(r.id)).map((r) => versLigne(r, false))],
    textilesTrace,
    variantsTrace: (prevus ?? []).map((p) => p.variant_id as string),
  };
}
