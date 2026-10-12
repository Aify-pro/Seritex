"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { CANAUX, TYPES_JOUR } from "@/lib/prospection/constantes";

/**
 * Paramètres > Prospection (migration 0122) : commerciaux, calendrier,
 * jours fériés et canaux. Droits du module « Paramètres prospection ».
 */

type Result = { error?: string };

const texte = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

/**
 * Numéro saisi librement (« 07 00 00 00 01 », « 00225… ») → format E.164,
 * celui qu'Evolution API transmet avec chaque message. Un numéro ivoirien à
 * 10 chiffres reçoit l'indicatif +225.
 */
function versE164(saisie: string): string | null {
  const brut = saisie.replace(/[\s.\-()]/g, "");
  if (!brut) return null;
  if (brut.startsWith("+")) return brut;
  if (brut.startsWith("00")) return `+${brut.slice(2)}`;
  if (/^0\d{9}$/.test(brut)) return `+225${brut}`;
  return `+${brut}`;
}

const commercialSchema = z.object({
  app_user_id: z.string().uuid("Choisissez un compte"),
  sage_representant_no: z.number().int().positive().nullable(),
  whatsapp: z
    .string()
    .transform(versE164)
    .refine((v) => v === null || /^\+[1-9]\d{7,14}$/.test(v), "Numéro WhatsApp invalide (ex. 07 00 00 00 01 ou +225 07 00 00 00 01)"),
  telegram_chat_id: texte(20).refine((v) => v === null || /^-?\d{1,20}$/.test(v), "Identifiant Telegram invalide (chiffres seulement)"),
  email_pro: texte(120).refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Adresse e-mail invalide"),
  zone: texte(80),
  soumis_obligation: z.boolean(),
  actif: z.boolean(),
  notes: texte(500),
});

const fin = () => {
  revalidatePath("/parametres/prospection");
  revalidatePath("/prospection");
};

function messageDoublon(message: string, detail?: string): string {
  const d = `${message} ${detail ?? ""}`;
  if (d.includes("app_user_id")) return "Ce compte est déjà enregistré comme commercial.";
  if (d.includes("whatsapp")) return "Ce numéro WhatsApp est déjà attribué à un autre commercial.";
  if (d.includes("telegram")) return "Cet identifiant Telegram est déjà attribué à un autre commercial.";
  if (d.includes("email")) return "Cette adresse e-mail est déjà attribuée à un autre commercial.";
  if (d.includes("sage_representant")) return "Ce collaborateur Sage est déjà rattaché à un autre commercial.";
  return "Doublon : une de ces informations est déjà utilisée.";
}

export async function enregistrerCommercial(id: string | null, input: z.input<typeof commercialSchema>): Promise<Result> {
  await requirePermission("parametres_prospection", id ? "modify" : "create");
  const parsed = commercialSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("commerciaux").update(parsed.data).eq("id", id)
    : await supabase.from("commerciaux").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? messageDoublon(error.message, error.details) : error.message };
  fin();
  return {};
}

export async function supprimerCommercial(id: string): Promise<Result> {
  await requirePermission("parametres_prospection", "delete");
  const supabase = await createClient();
  const { error } = await supabase.from("commerciaux").delete().eq("id", id);
  if (error) return { error: error.message };
  fin();
  return {};
}

const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:MM)");
const calendrierSchema = z.object({
  types_jour: z.array(z.enum(Object.keys(TYPES_JOUR) as [keyof typeof TYPES_JOUR])).length(7),
  heure_rappel: heure,
  heure_alerte: heure,
});

export async function enregistrerCalendrier(input: z.input<typeof calendrierSchema>): Promise<Result> {
  const { profile } = await requirePermission("parametres_prospection", "modify");
  const parsed = calendrierSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("prospection_reglages")
    .update({ ...parsed.data, updated_by: profile.id })
    .eq("id", true);
  if (error) return { error: error.message };
  fin();
  return {};
}

const ferieSchema = z.object({
  jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
  libelle: z.string().trim().min(1, "Donnez un libellé").max(80),
});

export async function ajouterJourFerie(input: z.input<typeof ferieSchema>): Promise<Result> {
  await requirePermission("parametres_prospection", "create");
  const parsed = ferieSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("jours_feries").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "Ce jour est déjà férié." : error.message };
  fin();
  return {};
}

export async function supprimerJourFerie(jour: string): Promise<Result> {
  await requirePermission("parametres_prospection", "delete");
  const supabase = await createClient();
  const { error } = await supabase.from("jours_feries").delete().eq("jour", jour);
  if (error) return { error: error.message };
  fin();
  return {};
}

const canalSchema = z.object({
  canal: z.enum(CANAUX),
  reception_active: z.boolean(),
  envoi_rappels: z.boolean(),
  envoi_alertes: z.boolean(),
  identifiant: texte(120),
});

export async function enregistrerCanal(input: z.input<typeof canalSchema>): Promise<Result> {
  const { profile } = await requirePermission("parametres_prospection", "modify");
  const parsed = canalSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const { canal, ...donnees } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("prospection_canaux")
    .update({ ...donnees, updated_by: profile.id })
    .eq("canal", canal);
  if (error) return { error: error.message };
  fin();
  return {};
}
