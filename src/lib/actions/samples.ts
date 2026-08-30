"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser, requireRole } from "@/lib/auth/current-user";
import type { SampleDecision, SampleRequestStatus, SamplePriority } from "@/lib/types/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newSampleSchema = z.object({
  need_description: z.string().min(1, "Merci de décrire le besoin"),
  quantity_requested: z.coerce.number().int().positive().default(1),
  company_id: z.string().uuid(),
  priority: z.enum(["basse", "normale", "haute", "urgente"]).default("normale"),
  request_date: z.string().min(1).optional(),
  due_date: z.string().optional(),
  extra_info: z.string().optional(),
});

function revalidateSamplePaths() {
  revalidatePath("/client/echantillons");
  revalidatePath("/commercial/echantillons");
}

export async function createSampleRequest(formData: FormData) {
  const { authId, profile } = await requireUser();
  const parsed = newSampleSchema.safeParse({
    need_description: formData.get("need_description"),
    quantity_requested: formData.get("quantity_requested"),
    company_id: formData.get("company_id") || profile.company_id,
    priority: formData.get("priority") || "normale",
    request_date: formData.get("request_date") || undefined,
    due_date: formData.get("due_date") || undefined,
    extra_info: formData.get("extra_info") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Un client ne peut créer une demande d'échantillon que pour sa propre
  // entreprise — vérification redondante avec la RLS, mais explicite ici.
  if (profile.role === "client" && parsed.data.company_id !== profile.company_id) {
    return { error: "Accès refusé" };
  }

  // Un client ne fixe ni la priorité, ni le délai (réservés au staff qui
  // arbitre la charge de l'atelier) — cohérent avec le fait qu'il ne peut
  // pas non plus lier l'échantillon à un ordre de fabrication.
  const priority: SamplePriority = profile.role === "client" ? "normale" : parsed.data.priority;

  const supabase = await createClient();
  const reference = "ECH-" + Date.now().toString(36).toUpperCase();

  const { error } = await supabase.from("sample_requests").insert({
    reference,
    company_id: parsed.data.company_id,
    need_description: parsed.data.need_description,
    quantity_requested: parsed.data.quantity_requested,
    created_by_user_id: authId,
    status: "demande",
    priority,
    request_date: parsed.data.request_date || new Date().toISOString().slice(0, 10),
    due_date: parsed.data.due_date || null,
    extra_info: parsed.data.extra_info || null,
  });

  if (error) return { error: error.message };
  revalidateSamplePaths();
  return {};
}

const detailsSchema = z.object({
  priority: z.enum(["basse", "normale", "haute", "urgente"]),
  due_date: z.string().optional(),
  extra_info: z.string().optional(),
});

/** Mise à jour de la fiche (priorité, délai, infos complémentaires) — réservée au staff commercial/production. */
export async function updateSampleDetails(sampleId: string, formData: FormData) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);

  const parsed = detailsSchema.safeParse({
    priority: formData.get("priority"),
    due_date: formData.get("due_date") || undefined,
    extra_info: formData.get("extra_info") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sample_requests")
    .update({
      priority: parsed.data.priority,
      due_date: parsed.data.due_date || null,
      extra_info: parsed.data.extra_info || null,
    })
    .eq("id", sampleId);

  if (error) return { error: error.message };
  revalidateSamplePaths();
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
  revalidateSamplePaths();
  return {};
}

/**
 * Lie ou délie (p_production_order_id = null) un échantillon à un ordre de
 * fabrication — référence libre, modifiable à tout moment (section 3.6 de
 * l'analyse), distincte d'une génération d'ordres de travail.
 */
export async function linkSampleToProductionOrder(sampleId: string, productionOrderId: string | null) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_sample_to_production_order", {
    p_sample_request_id: sampleId,
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidateSamplePaths();
  revalidatePath("/atelier/production");
  return {};
}

/** Attache un fichier déjà présent dans la médiathèque du client à la fiche échantillon. */
export async function attachMediaFileToSample(sampleId: string, mediaFileId: string) {
  const { authId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("sample_request_media_files").insert({
    sample_request_id: sampleId,
    media_file_id: mediaFileId,
    added_by: authId,
  });
  if (error) return { error: error.message };
  revalidateSamplePaths();
  return {};
}

export async function detachMediaFileFromSample(sampleId: string, mediaFileId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("sample_request_media_files")
    .delete()
    .eq("sample_request_id", sampleId)
    .eq("media_file_id", mediaFileId);
  if (error) return { error: error.message };
  revalidateSamplePaths();
  return {};
}
