import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveComponents, type CostComponent, type FabricContext, type PricingParams, type PrintGrid } from "@/lib/pricing";

/**
 * Client de lecture : par défaut celui de l'utilisateur (RLS : Direction et
 * administrateur seulement). Le calcul des prix proposés au commercial passe
 * le client d'administration (src/lib/quote-pricing.ts) et ne renvoie que des
 * prix de vente, jamais un coût.
 */
type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * Lecture des données de tarification (migration 0067) — tables réservées à
 * la Direction et à l'administrateur par la RLS (is_admin()) : appelé pour un
 * autre rôle, tout revient vide plutôt que d'exposer un coût.
 */

export interface PricingSettings extends PricingParams {
  fraisEcranParCouleur: number;
  updatedAt: string | null;
}

export async function getPricingSettings(db?: Db): Promise<PricingSettings> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase.from("pricing_settings").select("*").maybeSingle();
  return {
    chargesPct: Number(data?.charges_pct ?? 40),
    margePct: Number(data?.marge_pct ?? 15),
    arrondi: Number(data?.arrondi ?? 100),
    fraisEcranParCouleur: Number(data?.frais_ecran_par_couleur ?? 0),
    updatedAt: (data?.updated_at as string | undefined) ?? null,
  };
}

export async function getPrintGrid(db?: Db): Promise<PrintGrid> {
  const supabase = db ?? (await createClient());
  const [{ data: rows }, settings] = await Promise.all([
    supabase.from("print_costs").select("nb_couleurs,cout_piece").order("nb_couleurs"),
    getPricingSettings(supabase),
  ]);
  return {
    coutParNbCouleurs: Object.fromEntries((rows ?? []).map((r) => [r.nb_couleurs as number, Number(r.cout_piece)])),
    fraisEcranParCouleur: settings.fraisEcranParCouleur,
  };
}

export interface ModelPricing {
  /** Valeurs propres au modèle — null = paramètres généraux. */
  chargesPct: number | null;
  margePct: number | null;
  notes: string | null;
  components: CostComponent[];
  forced: Record<string, number>;
  updatedAt: string | null;
}

/** Grilles de plusieurs modèles en trois requêtes — page de synthèse comme fiche modèle. */
export async function getModelPricings(modelIds: string[], db?: Db): Promise<Record<string, ModelPricing>> {
  if (modelIds.length === 0) return {};
  const supabase = db ?? (await createClient());
  const [{ data: overrides }, { data: comps }, { data: forced }] = await Promise.all([
    supabase.from("model_pricing").select("*").in("product_model_id", modelIds),
    supabase
      .from("model_cost_components")
      .select("id,product_model_id,libelle,base,est_tissu,mode_calcul,perte_pct,display_order,model_cost_supplements(taille,supplement)")
      .in("product_model_id", modelIds)
      .order("display_order"),
    supabase.from("model_forced_prices").select("product_model_id,taille,prix").in("product_model_id", modelIds),
  ]);

  const out: Record<string, ModelPricing> = {};
  for (const id of modelIds) {
    const o = (overrides ?? []).find((r) => r.product_model_id === id);
    out[id] = {
      chargesPct: o?.charges_pct != null ? Number(o.charges_pct) : null,
      margePct: o?.marge_pct != null ? Number(o.marge_pct) : null,
      notes: (o?.notes as string | null) ?? null,
      updatedAt: (o?.updated_at as string | undefined) ?? null,
      components: (comps ?? [])
        .filter((c) => c.product_model_id === id)
        .map((c) => ({
          id: c.id as string,
          libelle: c.libelle as string,
          base: Number(c.base),
          estTissu: !!c.est_tissu,
          mode: (c.mode_calcul as "saisi" | "tissu_calcule" | null) ?? "saisi",
          pertePct: Number(c.perte_pct ?? 0),
          supplements: Object.fromEntries(
            ((c.model_cost_supplements ?? []) as { taille: string; supplement: number }[]).map((s) => [s.taille, Number(s.supplement)])
          ),
        })),
      forced: Object.fromEntries((forced ?? []).filter((f) => f.product_model_id === id).map((f) => [f.taille as string, Number(f.prix)])),
    };
  }
  return out;
}

/** Paramètres effectifs d'un modèle : les siens, sinon les généraux. */
export function effectiveParams(settings: PricingSettings, model: Pick<ModelPricing, "chargesPct" | "margePct">): PricingParams {
  return {
    chargesPct: model.chargesPct ?? settings.chargesPct,
    margePct: model.margePct ?? settings.margePct,
    arrondi: settings.arrondi,
  };
}

/**
 * Contexte tissu de chaque modèle (ART-C, A9) : surfaces par taille et le
 * textile de la déclinaison — celui demandé (`textileByModel`, ex. grammage
 * choisi sur le devis), sinon le tissu principal du modèle, sinon son premier
 * textile autorisé. Réservé, comme les coûts, à la Direction (RLS), ou au
 * client d'administration pour le calcul des prix de vente.
 */
export async function getFabricContexts(
  modelIds: string[],
  db?: Db,
  textileByModel: Record<string, string | null | undefined> = {}
): Promise<Record<string, FabricContext & { textileId: string | null }>> {
  if (modelIds.length === 0) return {};
  const supabase = db ?? (await createClient());
  const [{ data: models }, { data: allowed }, { data: areas }] = await Promise.all([
    supabase.from("product_models").select("id,textile_id").in("id", modelIds),
    supabase.from("product_model_textiles").select("product_model_id,textile_id").in("product_model_id", modelIds),
    supabase.from("model_size_fabric_area").select("product_model_id,taille,surface_m2").in("product_model_id", modelIds),
  ]);
  const textileIdOf = (id: string) =>
    textileByModel[id] ??
    ((models ?? []).find((m) => m.id === id)?.textile_id as string | null) ??
    ((allowed ?? []).find((a) => a.product_model_id === id)?.textile_id as string | undefined) ??
    null;
  const textileIds = [...new Set(modelIds.map(textileIdOf).filter((v): v is string => !!v))];
  const [{ data: textiles }, { data: prices }] = textileIds.length
    ? await Promise.all([
        supabase.from("textiles").select("id,nom,grammage").in("id", textileIds),
        supabase.from("textile_prices").select("textile_id,prix_kg").in("textile_id", textileIds),
      ])
    : [{ data: [] }, { data: [] }];

  const out: Record<string, FabricContext & { textileId: string | null }> = {};
  for (const id of modelIds) {
    const tid = textileIdOf(id);
    const t = (textiles ?? []).find((x) => x.id === tid);
    const p = (prices ?? []).find((x) => x.textile_id === tid);
    out[id] = {
      textileId: tid,
      textileNom: (t?.nom as string | undefined) ?? null,
      grammage: t?.grammage != null ? Number(t.grammage) : null,
      prixKg: p ? Number(p.prix_kg) : null,
      surfaces: Object.fromEntries(
        (areas ?? []).filter((a) => a.product_model_id === id).map((a) => [a.taille as string, Number(a.surface_m2)])
      ),
    };
  }
  return out;
}

/** Composants concrets d'un modèle pour un contexte tissu (tissu calculé résolu). */
export function resolvedPricing(pricing: ModelPricing, cles: string[], fabric: FabricContext | null) {
  return resolveComponents(pricing.components, cles, fabric);
}
