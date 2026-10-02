import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { roundMoney } from "@/lib/currency";
import { coefficient, printCostPerPiece, printSignature, salePriceForSize, type PrintSpec } from "@/lib/pricing";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { effectiveParams, getModelPricings, getPricingSettings, getPrintGrid } from "@/lib/tarification";

/**
 * Chiffrage des devis à partir de la tarification (lot E, migrations 0067/0068).
 *
 * Deux usages, deux niveaux de confidentialité :
 *   - suggestLinePrices() — pour le commercial : PRIX DE VENTE proposés par
 *     taille (mémoire du client, sinon grille du modèle). Lit les coûts avec le
 *     client d'administration mais ne renvoie jamais un coût ni une marge.
 *   - simulateQuote() — pour la Direction : prix de revient, prix de vente et
 *     marge par taille, lus avec le client de l'utilisateur (RLS is_admin()).
 */

export type PriceSource = "client" | "grille";

export interface SuggestedPrices {
  /** Prix de vente par clé de taille, dans la devise du devis. */
  prices: Record<string, number>;
  sources: Record<string, PriceSource>;
  /** Messages sans aucun coût (grille absente, impression non tarifée…). */
  notes: string[];
}

export interface PrintZoneInput {
  printable_zone_id: string;
  nb_couleurs: number;
}

/** Libellés des emplacements imprimables, pour des messages lisibles. */
async function printSpecs(db: ReturnType<typeof createAdminClient>, zones: PrintZoneInput[]): Promise<PrintSpec[]> {
  if (zones.length === 0) return [];
  const { data } = await db.from("product_printable_zones").select("id,zone_label").in("id", zones.map((z) => z.printable_zone_id));
  return zones.map((z) => ({ label: (data ?? []).find((r) => r.id === z.printable_zone_id)?.zone_label ?? "Emplacement", nbCouleurs: z.nb_couleurs }));
}

/**
 * Prix proposés pour chaque taille du modèle : le dernier prix validé pour ce
 * client, ce modèle et cette configuration d'impression s'il existe, sinon la
 * grille du modèle (article nu + impressions). Convertis dans la devise du
 * devis (taux = F CFA pour 1 unité).
 */
export async function suggestLinePrices(input: {
  companyId: string;
  productModelId: string;
  quantity: number;
  printZones: PrintZoneInput[];
  devise: string;
  tauxChange: number;
}): Promise<SuggestedPrices> {
  const db = createAdminClient();
  const sig = printSignature(input.printZones);
  const [sizesByModel, { data: memory }, settings, printGrid, pricings, specs] = await Promise.all([
    getSizeOptionsByModel([input.productModelId]),
    db
      .from("client_model_prices")
      .select("taille,prix_xof")
      .eq("company_id", input.companyId)
      .eq("product_model_id", input.productModelId)
      .eq("print_signature", sig),
    getPricingSettings(db),
    getPrintGrid(db),
    getModelPricings([input.productModelId], db),
    printSpecs(db, input.printZones),
  ]);

  const taux = input.tauxChange > 0 ? input.tauxChange : 1;
  const toQuoteCurrency = (xof: number) => roundMoney(xof / taux, input.devise);
  const pricing = pricings[input.productModelId];
  const params = effectiveParams(settings, pricing);
  const prints = printCostPerPiece(specs, printGrid, input.quantity);
  const notes: string[] = [];
  const memoryByCle = new Map((memory ?? []).map((m) => [m.taille as string, Number(m.prix_xof)]));

  const prices: Record<string, number> = {};
  const sources: Record<string, PriceSource> = {};
  let fromGrid = 0;
  for (const size of sizesByModel[input.productModelId] ?? []) {
    const remembered = memoryByCle.get(size.cle);
    if (remembered !== undefined) {
      prices[size.cle] = toQuoteCurrency(remembered);
      sources[size.cle] = "client";
      continue;
    }
    if (pricing.components.length === 0 || coefficient(params) === null) continue;
    const { pv } = salePriceForSize(pricing.components, size.cle, params, prints.cost, pricing.forced[size.cle] ?? null);
    if (pv === null) continue;
    prices[size.cle] = toQuoteCurrency(pv);
    sources[size.cle] = "grille";
    fromGrid += 1;
  }

  if (memoryByCle.size > 0) notes.push("Prix déjà accordés à ce client pour ce modèle et ces impressions repris.");
  if (pricing.components.length === 0 && memoryByCle.size === 0) notes.push("Aucune grille tarifaire pour ce modèle : prix à saisir (la Direction les vérifiera).");
  // Les avertissements d'impression ne citent que l'emplacement et le nombre de couleurs, jamais un coût.
  if (fromGrid > 0) notes.push(...prints.warnings);
  return { prices, sources, notes };
}

// ----------------------------------------------------------------------------
// Simulation de la Direction
// ----------------------------------------------------------------------------

export interface SimulatedSize {
  cle: string;
  libelle: string;
  quantite: number;
  /** Prix de vente du devis (devise du devis). */
  prixVente: number;
  /** Prix de vente converti en F CFA, pour comparer au prix de revient. */
  prixVenteXof: number;
  /** Prix de revient par pièce (F CFA) — null si la grille du modèle manque. */
  prixRevient: number | null;
  /** Marge après charges, en % du prix de vente (lecture de l'Excel). */
  margePct: number | null;
  /** Prix proposé par la grille (F CFA), pour comparaison. */
  prixGrille: number | null;
}

export interface SimulatedLine {
  quoteLineId: string;
  description: string;
  productModelId: string | null;
  sizes: SimulatedSize[];
  chargesPct: number;
  margeCiblePct: number;
  coutImpression: number;
  warnings: string[];
}

export interface QuoteSimulation {
  lines: SimulatedLine[];
  devise: string;
  tauxChange: number;
  /** Totaux en F CFA, sur les tailles dont le prix de revient est connu. */
  totalVenteXof: number;
  totalRevientXof: number;
  totalApresChargesXof: number;
  margeGlobalePct: number | null;
  /** Chiffrage à figer à la validation (validate_quote, migration 0068). */
  snapshot: {
    quote_line_id: string;
    taille: string;
    quantite: number;
    prix_vente: number;
    prix_revient: number | null;
    detail: Record<string, unknown>;
  }[];
}

/**
 * Simulation d'un devis par la Direction : pour chaque article de catalogue et
 * chaque taille commandée, prix de vente du devis face au prix de revient de la
 * grille (article nu + impressions de la ligne). Lue avec le client de
 * l'utilisateur : rien ne remonte pour un autre rôle que Direction/admin.
 */
export async function simulateQuote(quoteId: string): Promise<QuoteSimulation | null> {
  const supabase = await createClient();
  const { data: quote } = await supabase.from("quotes").select("id,devise,taux_change").eq("id", quoteId).maybeSingle();
  if (!quote) return null;
  const { data: rawLines } = await supabase
    .from("quote_lines")
    .select(
      "id,description,quantity,unit_price,product_model_id,quote_line_sizes(taille,quantite),quote_line_size_prices(taille,prix),quote_line_printable_zones(printable_zone_id,nb_couleurs,product_printable_zones(zone_label))"
    )
    .eq("quote_id", quoteId);

  const lines = (rawLines ?? []) as unknown as {
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    product_model_id: string | null;
    quote_line_sizes: { taille: string; quantite: number }[];
    quote_line_size_prices: { taille: string; prix: number }[];
    quote_line_printable_zones: { printable_zone_id: string; nb_couleurs: number; product_printable_zones: { zone_label: string } | null }[];
  }[];
  const modelIds = [...new Set(lines.map((l) => l.product_model_id).filter((id): id is string => !!id))];
  const [settings, printGrid, pricings, sizesByModel] = await Promise.all([
    getPricingSettings(),
    getPrintGrid(),
    getModelPricings(modelIds),
    getSizeOptionsByModel(modelIds),
  ]);

  const devise = (quote.devise as string | null) ?? "XOF";
  const taux = Number(quote.taux_change ?? 1) || 1;
  const sim: QuoteSimulation = {
    lines: [],
    devise,
    tauxChange: taux,
    totalVenteXof: 0,
    totalRevientXof: 0,
    totalApresChargesXof: 0,
    margeGlobalePct: null,
    snapshot: [],
  };

  for (const l of lines) {
    if (!l.product_model_id) continue;
    const pricing = pricings[l.product_model_id];
    const params = effectiveParams(settings, pricing);
    const specs = l.quote_line_printable_zones.map((z) => ({ label: z.product_printable_zones?.zone_label ?? "Emplacement", nbCouleurs: z.nb_couleurs }));
    const prints = printCostPerPiece(specs, printGrid, l.quantity);
    const hasGrid = pricing.components.length > 0 && coefficient(params) !== null;
    const warnings = [...prints.warnings];
    if (!hasGrid) warnings.push("Grille tarifaire du modèle non saisie : prix de revient inconnu (Tarification).");

    const priceByCle = new Map(l.quote_line_size_prices.map((p) => [p.taille, Number(p.prix)]));
    const options = sizesByModel[l.product_model_id] ?? [];
    const sizes: SimulatedSize[] = l.quote_line_sizes
      .slice()
      .sort((a, b) => options.findIndex((o) => o.cle === a.taille) - options.findIndex((o) => o.cle === b.taille))
      .map((s) => {
        // Ligne sans prix par taille (devis antérieur à 0068) : son prix unique.
        const prixVente = priceByCle.get(s.taille) ?? (priceByCle.size === 0 ? Number(l.unit_price) : 0);
        const prixVenteXof = prixVente * taux;
        const calc = hasGrid ? salePriceForSize(pricing.components, s.taille, params, prints.cost, pricing.forced[s.taille] ?? null) : null;
        const prixRevient = calc ? Math.round(calc.pr * 100) / 100 : null;
        const coutApresCharges = prixRevient !== null ? prixRevient / (1 - params.chargesPct / 100) : null;
        const margePct = coutApresCharges !== null && prixVenteXof > 0 ? ((prixVenteXof - coutApresCharges) / prixVenteXof) * 100 : null;
        if (prixRevient !== null && coutApresCharges !== null) {
          sim.totalVenteXof += prixVenteXof * s.quantite;
          sim.totalRevientXof += prixRevient * s.quantite;
          sim.totalApresChargesXof += coutApresCharges * s.quantite;
        }
        sim.snapshot.push({
          quote_line_id: l.id,
          taille: s.taille,
          quantite: s.quantite,
          prix_vente: prixVente,
          prix_revient: prixRevient,
          detail: {
            charges_pct: params.chargesPct,
            marge_cible_pct: params.margePct,
            cout_impression: Math.round(prints.cost * 100) / 100,
            impressions: specs,
            composants: pricing.components.map((c) => ({ libelle: c.libelle, cout: c.base + (c.supplements[s.taille] ?? 0), est_tissu: !!c.estTissu })),
            prix_force: pricing.forced[s.taille] ?? null,
            prix_grille: calc?.pv ?? null,
            taux_change: taux,
          },
        });
        return {
          cle: s.taille,
          libelle: options.find((o) => o.cle === s.taille)?.libelle ?? s.taille.split("/").pop() ?? s.taille,
          quantite: s.quantite,
          prixVente,
          prixVenteXof,
          prixRevient,
          margePct,
          prixGrille: calc?.pv ?? null,
        };
      });

    sim.lines.push({
      quoteLineId: l.id,
      description: l.description,
      productModelId: l.product_model_id,
      sizes,
      chargesPct: params.chargesPct,
      margeCiblePct: params.margePct,
      coutImpression: prints.cost,
      warnings,
    });
  }

  sim.margeGlobalePct = sim.totalVenteXof > 0 ? ((sim.totalVenteXof - sim.totalApresChargesXof) / sim.totalVenteXof) * 100 : null;
  return sim;
}
