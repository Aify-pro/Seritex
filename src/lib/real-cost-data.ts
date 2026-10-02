import "server-only";
import { createClient } from "@/lib/supabase/server";
import { computeRealCost, type RealCostResult, type TheoreticalRow } from "@/lib/real-cost";

/**
 * Données du prix de revient réel d'un ODF (lot F, migration 0070), lues avec
 * le client de l'utilisateur : chiffrage figé du devis (quote_cost_snapshots)
 * et paramètres de coût réservés à la Direction et à l'administrateur par la
 * RLS — pour un autre rôle, rien ne remonte.
 */

export interface OdfRealCost {
  id: string;
  reference: string;
  status: string;
  companyName: string | null;
  createdAt: string;
  /** Faux : aucun chiffrage figé (devis validé avant le lot E, ou ODF sans devis). */
  hasTheoretical: boolean;
  kgReception: number;
  kgRetour: number;
  piecesObtenues: number | null;
  prixKg: number | null;
  prixKgSource: "odf" | "textile" | null;
  /** Prix propre à l'ODF, tel que saisi (null = prix du textile). */
  prixKgOdf: number | null;
  textiles: { nom: string; prixKg: number | null }[];
  notes: string | null;
  result: RealCostResult | null;
}

type SnapshotDetail = { charges_pct?: number; composants?: { libelle: string; cout: number; est_tissu?: boolean }[]; taux_change?: number };

/** Part tissu d'un chiffrage figé : composants cochés « tissu » (à défaut, nommés « Tissu… »). */
function tissuOf(detail: SnapshotDetail): number {
  const comps = detail.composants ?? [];
  const flagged = comps.some((c) => c.est_tissu !== undefined);
  return comps
    .filter((c) => (flagged ? c.est_tissu : c.libelle.trim().toLowerCase().startsWith("tissu")))
    .reduce((s, c) => s + Number(c.cout || 0), 0);
}

export async function getOdfRealCosts(odfIds?: string[]): Promise<OdfRealCost[]> {
  const supabase = await createClient();
  let query = supabase
    .from("production_orders")
    .select("id,reference,status,quote_id,created_at,companies(name),quotes(taux_change)")
    .not("quote_id", "is", null)
    .order("created_at", { ascending: false });
  if (odfIds) query = query.in("id", odfIds);
  const { data: odfs } = await query;
  const list = odfs ?? [];
  if (list.length === 0) return [];

  const ids = list.map((o) => o.id as string);
  const quoteIds = list.map((o) => o.quote_id as string);
  const [{ data: snapshots }, { data: pesees }, { data: params }, { data: lines }, { data: rendements }] = await Promise.all([
    supabase.from("quote_cost_snapshots").select("quote_id,quantite,prix_vente,prix_revient,detail").in("quote_id", quoteIds),
    supabase.from("pesees").select("production_order_id,type,poids_kg").in("production_order_id", ids).in("type", ["reception_tissu", "retour_stock"]),
    supabase.from("production_order_real_costs").select("production_order_id,prix_tissu_kg,notes").in("production_order_id", ids),
    supabase.from("quote_lines").select("quote_id,product_models(textile_id,textiles(id,nom))").in("quote_id", quoteIds),
    supabase.from("rendement_par_odf").select("odf_id,pieces_obtenues").in("odf_id", ids),
  ]);

  const textileIds = [
    ...new Set(
      (lines ?? [])
        .map((l) => (l.product_models as unknown as { textile_id: string | null } | null)?.textile_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const { data: textilePrices } = textileIds.length
    ? await supabase.from("textile_prices").select("textile_id,prix_kg").in("textile_id", textileIds)
    : { data: [] as { textile_id: string; prix_kg: number }[] };

  return list.map((o) => {
    const quote = o.quotes as unknown as { taux_change: number | null } | null;
    const taux = Number(quote?.taux_change ?? 1) || 1;
    const snaps = (snapshots ?? []).filter((s) => s.quote_id === o.quote_id);
    const rows: TheoreticalRow[] = snaps.map((s) => {
      const detail = (s.detail ?? {}) as SnapshotDetail;
      return {
        quantite: s.quantite as number,
        prixVenteXof: Number(s.prix_vente) * (detail.taux_change ?? taux),
        prixRevient: s.prix_revient === null ? null : Number(s.prix_revient),
        tissu: tissuOf(detail),
        chargesPct: Number(detail.charges_pct ?? 0),
      };
    });

    const pes = (pesees ?? []).filter((p) => p.production_order_id === o.id);
    const kgReception = pes.filter((p) => p.type === "reception_tissu").reduce((s, p) => s + Number(p.poids_kg), 0);
    const kgRetour = pes.filter((p) => p.type === "retour_stock").reduce((s, p) => s + Number(p.poids_kg), 0);

    // Textiles des articles : un prix par défaut seulement s'il n'y en a qu'un, et qu'il est renseigné.
    const textiles = new Map<string, { nom: string; prixKg: number | null }>();
    for (const l of (lines ?? []).filter((x) => x.quote_id === o.quote_id)) {
      const t = (l.product_models as unknown as { textiles: { id: string; nom: string } | null } | null)?.textiles;
      if (!t) continue;
      const price = (textilePrices ?? []).find((p) => p.textile_id === t.id);
      textiles.set(t.id, { nom: t.nom, prixKg: price ? Number(price.prix_kg) : null });
    }
    const param = (params ?? []).find((p) => p.production_order_id === o.id);
    const prixKgOdf = param?.prix_tissu_kg != null ? Number(param.prix_tissu_kg) : null;
    const uniqueTextile = textiles.size === 1 ? [...textiles.values()][0] : null;
    const prixKg = prixKgOdf ?? uniqueTextile?.prixKg ?? null;

    return {
      id: o.id as string,
      reference: o.reference as string,
      status: o.status as string,
      companyName: (o.companies as unknown as { name: string } | null)?.name ?? null,
      createdAt: o.created_at as string,
      hasTheoretical: rows.length > 0,
      kgReception,
      kgRetour,
      piecesObtenues: ((rendements ?? []).find((r) => r.odf_id === o.id)?.pieces_obtenues as number | undefined) ?? null,
      prixKg,
      prixKgSource: prixKgOdf !== null ? "odf" : prixKg !== null ? "textile" : null,
      prixKgOdf,
      textiles: [...textiles.values()],
      notes: (param?.notes as string | null) ?? null,
      result: rows.length > 0 ? computeRealCost({ rows, kgMesures: kgReception > 0 ? kgReception - kgRetour : null, prixKg }) : null,
    };
  });
}
