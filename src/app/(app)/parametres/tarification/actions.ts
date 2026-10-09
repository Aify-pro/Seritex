"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { chargerParametresSerigraphie } from "@/lib/separation/encres-serveur";
import { grilleProposee } from "@/lib/separation/prix-revient";

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

// ============================================================================
// Sérigraphie : prix de revient (migration 0117)
// ============================================================================

const serigraphieSchema = z.object({
  cout_ecran: money,
  calage_min: z.number().min(0, "Durée invalide").max(600, "Durée invalide"),
  taux_horaire: money,
  impression_s: z.number().min(0, "Durée invalide").max(3600, "Durée invalide"),
  sechage_piece: money,
  gache_pct: pct,
  depot_g_m2: z.number().gt(0, "Dépôt invalide").max(5000, "Dépôt invalide"),
  perte_encre_pct: z.number().min(0, "Pourcentage invalide").max(499, "Pourcentage invalide"),
  prix_encre_kg: money.nullable(),
  surface_ref_cm2: z.number().gt(0, "Surface invalide").max(10_000, "Surface invalide"),
  quantite_ref: z.number().int().min(1, "Quantité invalide"),
});

/** Paramètres de coût de la sérigraphie de l'atelier. */
export async function saveSerigraphieParametres(input: z.input<typeof serigraphieSchema>) {
  const { profile } = await requirePermission("tarification", "modify");
  const parsed = serigraphieSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Paramètres invalides" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("serigraphie_parametres")
    .update({ ...parsed.data, updated_by: profile.id })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/parametres/tarification");
  return {};
}

/**
 * Reporte la grille proposée par les paramètres de sérigraphie dans la grille
 * impression (1 à 7 couleurs) et les frais d'écran par couleur. Recalculée
 * ici depuis les paramètres enregistrés : la Direction valide ce qu'elle voit.
 */
export async function appliquerGrilleSerigraphie() {
  const { profile } = await requirePermission("tarification", "modify");
  const supabase = await createClient();
  const parametres = await chargerParametresSerigraphie(supabase);
  if (!parametres) return { error: "Paramètres de sérigraphie illisibles." };
  const { lignes, fraisEcran } = grilleProposee(parametres);
  const maintenant = new Date().toISOString();
  const { error } = await supabase
    .from("print_costs")
    .upsert(lignes.map((l) => ({ nb_couleurs: l.nbCouleurs, cout_piece: l.coutPiece, updated_at: maintenant })));
  if (error) return { error: error.message };
  const { error: e2 } = await supabase
    .from("pricing_settings")
    .update({ frais_ecran_par_couleur: fraisEcran, updated_at: maintenant, updated_by: profile.id })
    .eq("id", true);
  if (e2) return { error: e2.message };
  revalidatePath("/parametres/tarification");
  revalidatePath("/articles", "layout");
  return {};
}
