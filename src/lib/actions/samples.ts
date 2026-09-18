"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser, requireRole } from "@/lib/auth/current-user";
import type { SampleDecision, SampleRequestStatus } from "@/lib/types/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newSampleSchema = z.object({
  request_id: z.string().uuid("Merci de choisir la demande à laquelle rattacher l'échantillon"),
  quote_line_id: z.string().uuid().optional(),
  need_description: z.string().min(1, "Merci de décrire le besoin"),
  priority: z.enum(["basse", "normale", "haute", "urgente"]).default("normale"),
  request_date: z.string().min(1).optional(),
  due_date: z.string().optional(),
  extra_info: z.string().optional(),
});

function revalidateSamplePaths(requestId?: string | null) {
  revalidatePath("/client/echantillons");
  revalidatePath("/commercial/echantillons");
  if (requestId) revalidatePath(`/commercial/demandes/${requestId}`);
}

/**
 * Création d'une fiche échantillon (migration 0051) — réservée au staff
 * commercial, toujours rattachée à une demande dont elle hérite
 * l'entreprise, éventuellement déjà liée à une ligne d'article d'un devis
 * de cette demande. Une fiche = un modèle d'échantillon fabriqué en un seul
 * exemplaire : plus de quantité saisie. Le trigger enforce_sample_links
 * revérifie demande/ligne de devis côté base.
 */
export async function createSampleRequest(formData: FormData) {
  const { authId } = await requireRole(["commercial", "administrateur"]);
  const parsed = newSampleSchema.safeParse({
    request_id: formData.get("request_id"),
    quote_line_id: formData.get("quote_line_id") || undefined,
    need_description: formData.get("need_description"),
    priority: formData.get("priority") || "normale",
    request_date: formData.get("request_date") || undefined,
    due_date: formData.get("due_date") || undefined,
    extra_info: formData.get("extra_info") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("company_id,contact_id")
    .eq("id", parsed.data.request_id)
    .maybeSingle();
  if (!request) return { error: "Demande introuvable" };

  const reference = "ECH-" + Date.now().toString(36).toUpperCase();

  const { data: sample, error } = await supabase
    .from("sample_requests")
    .insert({
      reference,
      request_id: parsed.data.request_id,
      quote_line_id: parsed.data.quote_line_id ?? null,
      company_id: request.company_id,
      contact_id: request.contact_id,
      need_description: parsed.data.need_description,
      quantity_requested: 1,
      created_by_user_id: authId,
      status: "demande",
      priority: parsed.data.priority,
      request_date: parsed.data.request_date || new Date().toISOString().slice(0, 10),
      due_date: parsed.data.due_date || null,
      extra_info: parsed.data.extra_info || null,
    })
    .select("sample_number")
    .single();

  if (error) return { error: error.message };
  revalidateSamplePaths(parsed.data.request_id);
  revalidatePath("/commercial/devis");
  return { sampleNumber: sample.sample_number as string };
}

/**
 * Rattache à une demande une fiche créée avant que ce rattachement ne soit
 * obligatoire (migration 0051) — seulement si elle n'en a pas encore : une
 * fois posée, la demande d'une fiche ne change plus.
 */
export async function attachSampleToRequest(sampleId: string, requestId: string) {
  await requireRole(["commercial", "administrateur"]);
  if (!z.string().uuid().safeParse(requestId).success) return { error: "Demande invalide" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sample_requests")
    .update({ request_id: requestId })
    .eq("id", sampleId)
    .is("request_id", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Cette fiche est déjà rattachée à une demande" };
  revalidateSamplePaths(requestId);
  return {};
}

/**
 * Lie ou délie (quoteLineId = null) un échantillon à une ligne d'article
 * d'un devis de sa demande (migration 0051). Une fois la ligne passée en
 * ODF, le lien suit l'article d'ODF et n'est plus modifiable — refusé par
 * la base (enforce_sample_links), pas seulement masqué dans l'écran.
 */
export async function linkSampleToQuoteLine(sampleId: string, quoteLineId: string | null) {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_sample_to_quote_line", {
    p_sample_request_id: sampleId,
    p_quote_line_id: quoteLineId,
  });
  if (error) return { error: error.message };
  revalidateSamplePaths();
  revalidatePath("/commercial/devis");
  revalidatePath("/commercial/demandes");
  return {};
}

const editSchema = z.object({
  need_description: z.string().min(1, "Merci de décrire le besoin"),
  priority: z.enum(["basse", "normale", "haute", "urgente"]),
  request_date: z.string().min(1).optional(),
  due_date: z.string().optional(),
  extra_info: z.string().optional(),
});

/**
 * Modification complète de la fiche (besoin, priorité, dates, infos
 * complémentaires) — réservée au staff qui gère l'échantillonnage
 * (commercial, responsable production, administrateur), quel que soit le
 * lien ou non à un ordre de fabrication : modifier une fiche ne remet rien
 * en cause pour un ordre de fabrication déjà référencé, contrairement à sa
 * suppression (cf. `deleteSampleRequest`).
 */
export async function updateSampleRequest(sampleId: string, formData: FormData) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);

  const parsed = editSchema.safeParse({
    need_description: formData.get("need_description"),
    priority: formData.get("priority"),
    request_date: formData.get("request_date") || undefined,
    due_date: formData.get("due_date") || undefined,
    extra_info: formData.get("extra_info") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sample_requests")
    .update({
      need_description: parsed.data.need_description,
      priority: parsed.data.priority,
      request_date: parsed.data.request_date || undefined,
      due_date: parsed.data.due_date || null,
      extra_info: parsed.data.extra_info || null,
    })
    .eq("id", sampleId);

  if (error) return { error: error.message };
  revalidateSamplePaths();
  return {};
}

/**
 * Suppression d'une fiche échantillon — réservée au staff qui gère
 * l'échantillonnage, et uniquement si la fiche n'est pas attribuée à un
 * ordre de fabrication (sinon on romprait la traçabilité essai ↔ commande
 * décrite en section 3.6 de l'analyse ; il faut d'abord délier via
 * `linkSampleToProductionOrder`). Passe par la fonction Postgres
 * `delete_sample_request` (SECURITY DEFINER, journalisée dans `audit_log`)
 * plutôt que par un DELETE direct, cohérent avec les autres mutations
 * sensibles du schéma.
 */
export async function deleteSampleRequest(sampleId: string) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_sample_request", { p_sample_request_id: sampleId });
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
 * Lie ou délie (production_order_line_id = null) un échantillon à un
 * article précis d'un ordre de fabrication (migration 0044, plus tout l'ODF
 * — nécessaire pour distinguer, dans un ODF multi-articles, quel article
 * l'échantillon concerne) — référence libre, modifiable à tout moment
 * (section 3.6 de l'analyse), distincte d'une génération d'ordres de
 * travail.
 */
export async function linkSampleToProductionOrderLine(sampleId: string, productionOrderLineId: string | null) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_sample_to_production_order_line", {
    p_sample_request_id: sampleId,
    p_production_order_line_id: productionOrderLineId,
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
