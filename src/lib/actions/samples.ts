"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser, requireRole } from "@/lib/auth/current-user";
import type { SampleDecision, SampleRequestStatus } from "@/lib/types/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newSampleSchema = z.object({
  need_description: z.string().min(1, "Merci de décrire le besoin"),
  quantity_requested: z.coerce.number().int().positive().default(1),
  company_id: z.string().uuid(),
});

export async function createSampleRequest(formData: FormData) {
  const { authId, profile } = await requireUser();
  const parsed = newSampleSchema.safeParse({
    need_description: formData.get("need_description"),
    quantity_requested: formData.get("quantity_requested"),
    company_id: formData.get("company_id") || profile.company_id,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Un client ne peut créer une demande d'échantillon que pour sa propre
  // entreprise — vérification redondante avec la RLS, mais explicite ici.
  if (profile.role === "client" && parsed.data.company_id !== profile.company_id) {
    return { error: "Accès refusé" };
  }

  const supabase = await createClient();
  const reference = "ECH-" + Date.now().toString(36).toUpperCase();

  const { error } = await supabase.from("sample_requests").insert({
    reference,
    company_id: parsed.data.company_id,
    need_description: parsed.data.need_description,
    quantity_requested: parsed.data.quantity_requested,
    created_by_user_id: authId,
    status: "demande",
  });

  if (error) return { error: error.message };
  revalidatePath("/client/echantillons");
  revalidatePath("/commercial/echantillons");
  return {};
}

export async function updateSampleStatus(sampleId: string, status: SampleRequestStatus) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sample_requests").update({ status }).eq("id", sampleId);
  if (error) return { error: error.message };
  revalidatePath("/commercial/echantillons");
  return {};
}

export async function submitSampleDecision(sampleId: string, decision: SampleDecision, feedback: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_sample_decision", {
    p_sample_request_id: sampleId,
    p_decision: decision,
    p_feedback: feedback || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/client/echantillons");
  revalidatePath("/commercial/echantillons");
  return {};
}
