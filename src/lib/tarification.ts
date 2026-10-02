import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CostComponent, PricingParams, PrintGrid } from "@/lib/pricing";

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
      .select("id,product_model_id,libelle,base,display_order,model_cost_supplements(taille,supplement)")
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
