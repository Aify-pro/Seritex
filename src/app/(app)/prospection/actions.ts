"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { MOTIFS_ABSENCE } from "@/lib/prospection/constantes";

/**
 * Absences des commerciaux (migration 0122). Le commercial déclare les
 * siennes (« demandée ») ; la direction (prospection / validate) les valide
 * ou les refuse, et peut en saisir directement pour un commercial — elles
 * sont alors validées d'office. La base re-vérifie tout (RLS).
 */

type Result = { error?: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");
const absenceSchema = z
  .object({
    app_user_id: z.string().uuid().nullable(),
    debut: date,
    fin: date,
    motif: z.enum(Object.keys(MOTIFS_ABSENCE) as [keyof typeof MOTIFS_ABSENCE]),
    commentaire: z
      .string()
      .trim()
      .max(500)
      .transform((v) => v || null),
  })
  .refine((a) => a.fin >= a.debut, { message: "La fin précède le début" });

const fin = () => revalidatePath("/prospection");

export async function declarerAbsence(input: z.input<typeof absenceSchema>): Promise<Result> {
  const { profile } = await requirePermission("prospection", "create");
  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const pourAutrui = parsed.data.app_user_id !== null && parsed.data.app_user_id !== profile.id;
  if (pourAutrui && !(await can("prospection", "validate"))) {
    return { error: "Seule la direction saisit une absence pour un autre commercial." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("absences_commerciaux").insert({
    ...parsed.data,
    app_user_id: parsed.data.app_user_id ?? profile.id,
    statut: pourAutrui ? "validee" : "demandee",
  });
  if (error) return { error: error.message };
  fin();
  return {};
}

export async function traiterAbsence(id: string, decision: "validee" | "refusee", motifRefus: string): Promise<Result> {
  await requirePermission("prospection", "validate");
  const parsed = z
    .object({ id: z.string().uuid(), decision: z.enum(["validee", "refusee"]), motifRefus: z.string().trim().max(300) })
    .safeParse({ id, decision, motifRefus });
  if (!parsed.success) return { error: "Saisie invalide" };
  if (decision === "refusee" && !parsed.data.motifRefus) return { error: "Indiquez le motif du refus." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("absences_commerciaux")
    .update({ statut: decision, motif_refus: decision === "refusee" ? parsed.data.motifRefus : null })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Absence introuvable." };
  fin();
  return {};
}

export async function retirerAbsence(id: string): Promise<Result> {
  await requirePermission("prospection", "create");
  const supabase = await createClient();
  const { data, error } = await supabase.from("absences_commerciaux").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Une absence déjà traitée ne peut être retirée que par la direction." };
  fin();
  return {};
}
