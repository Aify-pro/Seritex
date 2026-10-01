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
  conditions_paiement_defaut: longText,
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
