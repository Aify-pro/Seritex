"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Paramétrage de la tarification (migration 0067), sous Paramètres :
 * charges et marge par défaut, coefficient, grille impression, prix des
 * textiles au kg. La grille de chaque modèle se saisit dans sa fiche article.
 * Réservé à la Direction et à l'administrateur — la RLS l'impose aussi.
 */

const pct = z.number().min(0, "Pourcentage invalide").max(99.99, "Doit rester sous 100 %");
const money = z.number().min(0, "Montant invalide");

const settingsSchema = z.object({
  charges_pct: pct,
  marge_pct: pct,
  arrondi: z.number().int().min(1, "Arrondi invalide"),
  frais_ecran_par_couleur: money,
  // A8 : vide = coefficient calculé depuis charges et marge.
  coef_prix_vente: z.number().gt(0, "Coefficient invalide").max(99, "Coefficient invalide").nullable().optional(),
});

export async function updatePricingSettings(input: z.input<typeof settingsSchema>) {
  const { profile } = await requirePermission("tarification", "modify");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Paramètres invalides" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("pricing_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/parametres/tarification");
  revalidatePath("/articles", "layout");
  return {};
}

const printCostsSchema = z.record(z.string().regex(/^([1-9]|1[0-2])$/), money.nullable());

/** Grille impression : un coût par nombre de couleurs ; vide = retiré de la grille (signalé au chiffrage). */
export async function savePrintCosts(input: Record<string, number | null>) {
  await requirePermission("tarification", "modify");
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
  revalidatePath("/parametres/tarification");
  revalidatePath("/articles", "layout");
  return {};
}

/** Prix du tissu au kg, rendu, d'un textile (migration 0070) ; null retire le prix. */
export async function saveTextilePrice(textileId: string, prixKg: number | null) {
  const { profile } = await requirePermission("tarification", "modify");
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
  revalidatePath("/parametres/tarification");
  revalidatePath("/articles", "layout");
  return {};
}
