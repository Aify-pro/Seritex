"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const text = z.string().trim().max(500).transform((v) => v || null);
const longText = z.string().trim().max(2000).transform((v) => v || null);
const percent = (label: string) =>
  z.coerce.number({ error: `${label} invalide` }).min(0, `${label} : minimum 0`).max(100, `${label} : maximum 100`);

const schema = z.object({
  raison_sociale: z.string().trim().min(1, "La raison sociale est requise").max(200),
  nom_commercial: text,
  forme_juridique: text,
  capital_social: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(/\s/g, ""))))
    .pipe(z.number({ error: "Capital social invalide" }).int().min(0).nullable()),
  rccm: text,
  ncc: text,
  regime_imposition: text,
  centre_impots: text,
  numero_cnps: text,
  assujetti_tva: z.boolean(),
  adresse: text,
  boite_postale: text,
  ville: text,
  pays: z.string().trim().min(1, "Le pays est requis").max(100),
  telephone: text,
  email: z.string().trim().email("E-mail invalide").or(z.literal("")).transform((v) => v || null),
  site_web: text,
  banque_nom: text,
  banque_compte: text,
  banque_swift: text,
  mobile_money: text,
  signataire_nom: text,
  signataire_fonction: text,
  tva_taux_defaut: percent("Taux de TVA"),
  validite_devis_jours: z.coerce.number().int("Validité invalide").min(1, "Validité : 1 jour minimum").max(365, "Validité : 365 jours maximum"),
  acompte_pct_defaut: percent("Acompte"),
  mentions_devis: longText,
});

/** Met à jour la fiche société (ligne unique) — réservé à l'administrateur de plateforme. */
export async function updateCompanySettings(id: string, formData: FormData) {
  const current = await requirePlatformAdmin();

  const raw: Record<string, FormDataEntryValue | boolean | null> = {};
  for (const key of Object.keys(schema.shape)) raw[key] = formData.get(key) ?? "";
  raw.assujetti_tva = formData.get("assujetti_tva") === "on";

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Données invalides" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: current.profile.id })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/parametres/societe");
  return {};
}

// ── Conditions de paiement ──────────────────────────────────────────────────

export async function addPaymentTerm(label: string) {
  await requirePlatformAdmin();
  const parsed = z.string().trim().min(2, "Libellé trop court").max(120, "Libellé trop long").safeParse(label);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: last } = await supabase.from("payment_terms").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("payment_terms").insert({ label: parsed.data, display_order: (last?.display_order ?? 0) + 10 });
  if (error) return { error: error.code === "23505" ? "Cette condition existe déjà" : error.message };

  revalidatePath("/parametres/societe");
  return {};
}

export async function setPaymentTermActive(id: string, active: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: term } = await supabase.from("payment_terms").select("is_default").eq("id", id).maybeSingle();
  if (!term) return { error: "Condition introuvable" };
  if (!active && term.is_default) return { error: "Choisissez d'abord une autre condition par défaut" };

  const { error } = await supabase.from("payment_terms").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

export async function setDefaultPaymentTerm(id: string) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  // L'index unique partiel n'autorise qu'une valeur par défaut : on retire l'ancienne d'abord.
  const { error: clearError } = await supabase.from("payment_terms").update({ is_default: false }).eq("is_default", true);
  if (clearError) return { error: clearError.message };
  const { error } = await supabase.from("payment_terms").update({ is_default: true, active: true }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

/** Supprime une condition ajoutée par l'utilisateur (les 4 de base se désactivent seulement). */
export async function deletePaymentTerm(id: string) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: term } = await supabase.from("payment_terms").select("is_system,is_default").eq("id", id).maybeSingle();
  if (!term) return { error: "Condition introuvable" };
  if (term.is_system) return { error: "Une condition de base ne se supprime pas : désactivez-la" };
  if (term.is_default) return { error: "Choisissez d'abord une autre condition par défaut" };

  const { error } = await supabase.from("payment_terms").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

// ── Devises ─────────────────────────────────────────────────────────────────

const rateSchema = z.coerce.number({ error: "Taux invalide" }).positive("Le taux doit être supérieur à 0");

/** Taux indicatif : F CFA pour 1 unité de la devise. Les devis déjà émis gardent leur taux figé. */
export async function updateCurrencyRate(code: string, rate: string) {
  await requirePlatformAdmin();
  const parsed = rateSchema.safeParse(rate);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("currencies")
    .update({ rate_xof: parsed.data, updated_at: new Date().toISOString() })
    .eq("code", code)
    .eq("is_base", false);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

export async function setCurrencyActive(code: string, active: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: cur } = await supabase.from("currencies").select("is_base,rate_xof").eq("code", code).maybeSingle();
  if (!cur) return { error: "Devise introuvable" };
  if (cur.is_base) return { error: "Le franc CFA est la devise de base" };
  if (active && !cur.rate_xof) return { error: "Renseignez d'abord un taux de change" };

  const { error } = await supabase.from("currencies").update({ active, updated_at: new Date().toISOString() }).eq("code", code);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

const newCurrencySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Code ISO sur 3 lettres (ex. CAD)"),
  label: z.string().trim().min(2, "Libellé requis").max(80),
  rate: rateSchema,
});

export async function addCurrency(code: string, label: string, rate: string) {
  await requirePlatformAdmin();
  const parsed = newCurrencySchema.safeParse({ code, label, rate });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Refuse un code que le moteur de formatage ne connaît pas (évite un devis inaffichable).
  try {
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: parsed.data.code });
  } catch {
    return { error: "Code devise ISO 4217 inconnu" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("currencies").insert({
    code: parsed.data.code,
    label: parsed.data.label,
    rate_xof: parsed.data.rate,
    active: true,
    display_order: 100,
  });
  if (error) return { error: error.code === "23505" ? "Cette devise existe déjà" : error.message };
  revalidatePath("/parametres/societe");
  return {};
}
