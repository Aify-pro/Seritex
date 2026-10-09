"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ETATS_ECRAN, SECHAGES, TYPES_MACHINE } from "@/lib/atelier/parc";

/**
 * Machines et écrans de sérigraphie (migration 0119). Droits du module
 * « Machines et écrans » ; le coût horaire d'une machine, droits Tarification.
 */

type Result = { error?: string };

const texte = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const mesure = z.number().positive("Mesure invalide").max(1000).nullable();

const machineSchema = z.object({
  nom: z.string().trim().min(1, "Donnez un nom à la machine").max(80),
  type: z.enum(Object.keys(TYPES_MACHINE) as [keyof typeof TYPES_MACHINE]),
  nb_stations: z.number().int().min(1).max(40),
  nb_tetes: z.number().int().min(1, "Au moins une tête").max(40),
  format_max_l_cm: mesure,
  format_max_h_cm: mesure,
  sechage: z.enum(Object.keys(SECHAGES) as [keyof typeof SECHAGES]),
  cadence_pieces_h: z.number().int().positive("Cadence invalide").max(5000).nullable(),
  notes: texte(500),
  active: z.boolean(),
  /** Coût horaire (Direction) : absent = inchangé. */
  cout_horaire: z.number().min(0).max(10_000_000).nullable().optional(),
});

const fin = () => {
  revalidatePath("/atelier/machines");
  revalidatePath("/infographie/separation");
};

async function enregistrerCout(machineId: string, cout: number | null | undefined): Promise<string | null> {
  if (cout === undefined) return null;
  const { profile } = await requirePermission("tarification", "modify");
  const supabase = await createClient();
  const { error } =
    cout === null
      ? await supabase.from("machine_couts").delete().eq("machine_id", machineId)
      : await supabase.from("machine_couts").upsert({ machine_id: machineId, cout_horaire: cout, updated_by: profile.id });
  return error?.message ?? null;
}

export async function enregistrerMachine(id: string | null, input: z.input<typeof machineSchema>): Promise<Result> {
  await requirePermission("machines_ecrans", id ? "modify" : "create");
  const parsed = machineSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const { cout_horaire, ...donnees } = parsed.data;
  if (donnees.nb_tetes > donnees.nb_stations) return { error: "Une machine ne peut pas avoir plus de têtes que de stations." };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("machines").update(donnees).eq("id", id).select("id").single()
    : await supabase.from("machines").insert(donnees).select("id").single();
  if (error) return { error: error.code === "23505" ? `La machine « ${donnees.nom} » existe déjà.` : error.message };
  const e = await enregistrerCout(data.id as string, cout_horaire);
  fin();
  return e ? { error: `Machine enregistrée, mais pas son coût horaire : ${e}` } : {};
}

export async function supprimerMachine(id: string): Promise<Result> {
  await requirePermission("machines_ecrans", "delete");
  const supabase = await createClient();
  const { error } = await supabase.from("machines").delete().eq("id", id);
  if (error) return { error: error.message };
  fin();
  return {};
}

const ecranSchema = z.object({
  code: z.string().trim().min(1, "Donnez un code à l'écran").max(30),
  largeur_cm: z.number().positive("Largeur invalide").max(1000),
  hauteur_cm: z.number().positive("Hauteur invalide").max(1000),
  maillage: z.number().int().min(10, "Maillage invalide (fils/cm)").max(200, "Maillage invalide (fils/cm)"),
  couleur_maille: z.enum(["blanche", "jaune"]),
  etat: z.enum(Object.keys(ETATS_ECRAN) as [keyof typeof ETATS_ECRAN]),
  travail: texte(120),
  emplacement: texte(60),
  notes: texte(500),
});

export async function enregistrerEcran(id: string | null, input: z.input<typeof ecranSchema>): Promise<Result> {
  await requirePermission("machines_ecrans", id ? "modify" : "create");
  const parsed = ecranSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("ecrans_cadres").update(parsed.data).eq("id", id)
    : await supabase.from("ecrans_cadres").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? `L'écran « ${parsed.data.code} » existe déjà.` : error.message };
  fin();
  return {};
}

/** Changement d'état rapide (insolé pour un travail, à récupérer, disponible…). */
export async function changerEtatEcran(id: string, etat: string, travail: string | null): Promise<Result> {
  await requirePermission("machines_ecrans", "modify");
  const parsed = z
    .object({ etat: z.enum(Object.keys(ETATS_ECRAN) as [keyof typeof ETATS_ECRAN]), travail: texte(120).nullable() })
    .safeParse({ etat, travail: travail ?? "" });
  if (!parsed.success) return { error: "État invalide" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ecrans_cadres")
    .update({ etat: parsed.data.etat, travail: parsed.data.etat === "insole" ? parsed.data.travail : null })
    .eq("id", id);
  if (error) return { error: error.message };
  fin();
  return {};
}

export async function supprimerEcran(id: string): Promise<Result> {
  await requirePermission("machines_ecrans", "delete");
  const supabase = await createClient();
  const { error } = await supabase.from("ecrans_cadres").delete().eq("id", id);
  if (error) return { error: error.message };
  fin();
  return {};
}
