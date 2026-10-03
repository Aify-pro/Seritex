"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Écritures du module Tarification (migration 0067). Réservées à la Direction
 * et à l'administrateur (base_role administrateur) — la RLS l'impose aussi.
 */

const pct = z.number().min(0, "Pourcentage invalide").max(99.99, "Doit rester sous 100 %");
const money = z.number().min(0, "Montant invalide");

const settingsSchema = z.object({
  charges_pct: pct,
  marge_pct: pct,
  arrondi: z.number().int().min(1, "Arrondi invalide"),
  frais_ecran_par_couleur: money,
});

export async function updatePricingSettings(input: z.input<typeof settingsSchema>) {
  const { profile } = await requireRole(["administrateur"]);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Paramètres invalides" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("pricing_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/tarification", "layout");
  return {};
}

const printCostsSchema = z.record(z.string().regex(/^([1-9]|1[0-2])$/), money.nullable());

/** Grille impression : un coût par nombre de couleurs ; vide = retiré de la grille (signalé au chiffrage). */
export async function savePrintCosts(input: Record<string, number | null>) {
  await requireRole(["administrateur"]);
  const parsed = printCostsSchema.safeParse(input);
  if (!parsed.success) return { error: "Grille impression invalide" };

  const supabase = await createClient();
  const toDelete = Object.entries(parsed.data).filter(([, v]) => v === null).map(([k]) => Number(k));
  const toUpsert = Object.entries(parsed.data)
    .filter((e): e is [string, number] => e[1] !== null)
    .map(([k, v]) => ({ nb_couleurs: Number(k), cout_piece: v, updated_at: new Date().toISOString() }));

  if (toDelete.length > 0) {
    const { error } = await supabase.from("print_costs").delete().in("nb_couleurs", toDelete);
    if (error) return { error: error.message };
  }
  if (toUpsert.length > 0) {
    const { error } = await supabase.from("print_costs").upsert(toUpsert);
    if (error) return { error: error.message };
  }
  revalidatePath("/tarification", "layout");
  return {};
}

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
  const { profile } = await requireRole(["administrateur"]);
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

  revalidatePath("/tarification", "layout");
  revalidatePath("/articles", "layout");
  return {};
}

/**
 * Surfaces de tissu par taille d'un modèle (ART-C) — base du coût tissu
 * calculé. Remplace l'ensemble ; une taille vide est retirée.
 */
export async function saveFabricAreas(productModelId: string, surfaces: Record<string, number | null>, source: "patronnage" | "placement" | "saisie") {
  const { profile } = await requireRole(["administrateur"]);
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
  revalidatePath("/tarification", "layout");
  return {};
}

/** Surface par pièce proposée depuis les tracés de placement du modèle (m²). */
export async function proposeFabricAreaFromPlacement(productModelId: string): Promise<{ error?: string; surface?: number | null }> {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("propose_fabric_area_from_placement", { p_model_id: productModelId });
  if (error) return { error: error.message };
  return { surface: data === null ? null : Number(data) };
}

/** Prix du tissu au kg, rendu, d'un textile (migration 0070) ; null retire le prix. */
export async function saveTextilePrice(textileId: string, prixKg: number | null) {
  const { profile } = await requireRole(["administrateur"]);
  const parsed = z.object({ id: z.guid(), prix: z.number().positive("Prix au kg invalide").nullable() }).safeParse({ id: textileId, prix: prixKg });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Prix invalide" };

  const supabase = await createClient();
  const { error } =
    parsed.data.prix === null
      ? await supabase.from("textile_prices").delete().eq("textile_id", textileId)
      : await supabase
          .from("textile_prices")
          .upsert({ textile_id: textileId, prix_kg: parsed.data.prix, updated_at: new Date().toISOString(), updated_by: profile.id });
  if (error) return { error: error.message };
  revalidatePath("/tarification", "layout");
  return {};
}

/**
 * Paramètres de l'analyse du prix de revient réel d'un ODF (migration 0070) :
 * prix du tissu au kg propre à cet ODF (null = prix du textile) et notes.
 */
export async function saveOdfRealCost(productionOrderId: string, input: { prix_tissu_kg: number | null; notes: string }) {
  const { profile } = await requireRole(["administrateur"]);
  const parsed = z
    .object({
      prix_tissu_kg: z.number().positive("Prix au kg invalide").nullable(),
      notes: z.string().trim().max(2000).transform((v) => v || null),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Paramètres invalides" };

  const supabase = await createClient();
  const { error } = await supabase.from("production_order_real_costs").upsert({
    production_order_id: productionOrderId,
    ...parsed.data,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/tarification", "layout");
  return {};
}
