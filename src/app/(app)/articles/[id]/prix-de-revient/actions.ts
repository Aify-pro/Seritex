"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Grille de prix de revient d'un modèle (migration 0067, ART-C), saisie dans
 * l'onglet Prix de revient de la fiche article. Direction et administrateur.
 */

const pct = z.number().min(0, "Pourcentage invalide").max(99.99, "Doit rester sous 100 %");
const money = z.number().min(0, "Montant invalide");

const modelPricingSchema = z.object({
  charges_pct: pct.nullable(),
  marge_pct: pct.nullable(),
  notes: z.string().trim().max(2000).transform((v) => v || null),
  components: z
    .array(
      z.object({
        libelle: z.string().trim().min(1, "Chaque composant doit avoir un libellé").max(120),
        base: money,
        est_tissu: z.boolean().default(false),
        // Tissu calculé (ART-C, A9) : surface × grammage × prix au kg.
        mode_calcul: z.enum(["saisi", "tissu_calcule"]).default("saisi"),
        perte_pct: z.number().min(0).max(99).default(0),
        // Supplément par taille : peut être négatif (taille moins coûteuse que la base).
        supplements: z.record(z.string().min(1), z.number()),
      })
    )
    .max(50),
  forced: z.record(z.string().min(1), z.number().positive("Un prix forcé doit être positif")),
});

export type ModelPricingInput = z.input<typeof modelPricingSchema>;

/**
 * Enregistre la grille d'un modèle : paramètres propres, composants (base +
 * suppléments par taille) et prix forcés. Remplace l'ensemble — la grille se
 * saisit et se relit d'un bloc, sans historique partiel à préserver.
 */
export async function saveModelPricing(productModelId: string, input: ModelPricingInput) {
  const { profile } = await requirePermission("tarification", "modify");
  const parsed = modelPricingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Grille invalide" };
  const g = parsed.data;

  const supabase = await createClient();
  const { error: upError } = await supabase.from("model_pricing").upsert({
    product_model_id: productModelId,
    charges_pct: g.charges_pct,
    marge_pct: g.marge_pct,
    notes: g.notes,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (upError) return { error: upError.message };

  const { error: delCompError } = await supabase.from("model_cost_components").delete().eq("product_model_id", productModelId);
  if (delCompError) return { error: delCompError.message };

  for (const [i, c] of g.components.entries()) {
    const { data: comp, error } = await supabase
      .from("model_cost_components")
      .insert({
        product_model_id: productModelId,
        libelle: c.libelle,
        base: c.base,
        est_tissu: c.est_tissu || c.mode_calcul === "tissu_calcule",
        mode_calcul: c.mode_calcul,
        perte_pct: c.perte_pct,
        display_order: i,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    const supplements = Object.entries(c.supplements)
      .filter(([, v]) => v !== 0)
      .map(([taille, supplement]) => ({ component_id: comp.id, taille, supplement }));
    if (supplements.length > 0) {
      const { error: supError } = await supabase.from("model_cost_supplements").insert(supplements);
      if (supError) return { error: supError.message };
    }
  }

  const { error: delForcedError } = await supabase.from("model_forced_prices").delete().eq("product_model_id", productModelId);
  if (delForcedError) return { error: delForcedError.message };
  const forced = Object.entries(g.forced).map(([taille, prix]) => ({ product_model_id: productModelId, taille, prix }));
  if (forced.length > 0) {
    const { error } = await supabase.from("model_forced_prices").insert(forced);
    if (error) return { error: error.message };
  }

  revalidatePath("/articles", "layout");
  return {};
}

/**
 * Surfaces de tissu par taille d'un modèle (ART-C) — base du coût tissu
 * calculé. Remplace l'ensemble ; une taille vide est retirée.
 */
export async function saveFabricAreas(productModelId: string, surfaces: Record<string, number | null>, source: "patronnage" | "placement" | "saisie") {
  const { profile } = await requirePermission("tarification", "modify");
  const rows = Object.entries(surfaces).filter(([, v]) => v !== null && Number.isFinite(v) && (v as number) > 0);
  if (rows.some(([, v]) => (v as number) >= 20)) return { error: "Surface invalide (m² par pièce)." };
  const supabase = await createClient();
  const { error: delError } = await supabase.from("model_size_fabric_area").delete().eq("product_model_id", productModelId);
  if (delError) return { error: delError.message };
  if (rows.length > 0) {
    const { error } = await supabase.from("model_size_fabric_area").insert(
      rows.map(([taille, surface]) => ({
        product_model_id: productModelId,
        taille,
        surface_m2: surface,
        source,
        updated_by: profile.id,
      }))
    );
    if (error) return { error: error.message };
  }
  revalidatePath("/articles", "layout");
  return {};
}

/** Surface par pièce proposée depuis les tracés de placement du modèle (m²). */
export async function proposeFabricAreaFromPlacement(productModelId: string): Promise<{ error?: string; surface?: number | null }> {
  await requirePermission("tarification", "modify");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("propose_fabric_area_from_placement", { p_model_id: productModelId });
  if (error) return { error: error.message };
  return { surface: data === null ? null : Number(data) };
}

const purchaseSchema = z.object({
  mode_prix: z.enum(["calcule", "saisi"]),
  prix_achat: money.nullable(),
  frais_pct: z.number().min(0, "Frais invalides").max(499),
  prix_vente: z.number().positive("Prix de vente invalide").nullable(),
  charges_pct: pct.nullable(),
  marge_pct: pct.nullable(),
});

/** Prix d'un tissu ou d'un consommable (migration 0104) : valeurs de l'article. */
export async function saveArticlePurchasePricing(productModelId: string, input: z.input<typeof purchaseSchema>) {
  const { profile } = await requirePermission("tarification", "modify");
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("model_pricing").upsert({
    product_model_id: productModelId,
    ...parsed.data,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}

const variantPurchaseSchema = z.object({
  mode_prix: z.enum(["calcule", "saisi"]).nullable(),
  prix_achat: money.nullable(),
  frais_pct: z.number().min(0).max(499).nullable(),
  prix_vente: z.number().positive("Prix de vente invalide").nullable(),
});

/** Prix d'une déclinaison quand il diffère de celui de l'article ; tout vide = valeur de l'article. */
export async function saveVariantPricing(variantId: string, input: z.input<typeof variantPurchaseSchema>) {
  const { profile } = await requirePermission("tarification", "modify");
  const parsed = variantPurchaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const vide = Object.values(parsed.data).every((v) => v === null);
  const { error } = vide
    ? await supabase.from("variant_pricing").delete().eq("variant_id", variantId)
    : await supabase.from("variant_pricing").upsert({ variant_id: variantId, ...parsed.data, updated_at: new Date().toISOString(), updated_by: profile.id });
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}
