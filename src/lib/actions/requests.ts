"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const messageSchema = z.string().trim().min(1, "Le message ne peut pas être vide").max(4000);

/** Poster un message dans le fil d'une demande — ouvert au client (de son
 * entreprise) comme au staff, la RLS de `messages` fait respecter le
 * cloisonnement réel. */
export async function postMessage(requestId: string, formData: FormData) {
  const { authId } = await requireUser();
  const parsed = messageSchema.safeParse(formData.get("body"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("messages")
    .insert({ request_id: requestId, sender_id: authId, body: parsed.data });

  if (error) return { error: error.message };
  revalidatePath(`/commercial/demandes/${requestId}`);
  revalidatePath(`/client/demandes/${requestId}`);
  return {};
}

const newClientRequestSchema = z.object({
  description: z.string().min(1, "Merci de décrire votre besoin"),
});

export async function createClientRequest(formData: FormData) {
  const { authId, profile } = await requireUser();
  if (profile.role !== "client" || !profile.company_id) {
    return { error: "Accès refusé" };
  }

  const parsed = newClientRequestSchema.safeParse({ description: formData.get("description") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const reference = "REQ-" + Date.now().toString(36).toUpperCase();

  const { data, error } = await supabase
    .from("requests")
    .insert({
      reference,
      company_id: profile.company_id,
      description: parsed.data.description,
      source: "portail",
      created_by: authId,
      status: "nouvelle",
    })
    .select()
    .single();

  if (error) return { error: error.message };
  revalidatePath("/client/demandes");
  return { requestId: data.id as string };
}

function revalidateMediaLibrary(companyId: string) {
  revalidatePath(`/mediatheque/${companyId}`);
  revalidatePath("/client/mediatheque");
}

/**
 * Affilie un fichier de la médiathèque à une demande (migration 0043) —
 * un fichier peut être affilié à plusieurs demandes, pour être réutilisé
 * de l'une à l'autre sans le redéposer. Même forme que
 * attachMediaFileToSample (src/lib/actions/samples.ts) : insertion directe
 * sur la table de jonction, la RLS de request_media_files fait autorité.
 */
export async function attachMediaFileToRequest(requestId: string, mediaFileId: string) {
  const { authId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("request_media_files").insert({
    request_id: requestId,
    media_file_id: mediaFileId,
    added_by: authId,
  });
  if (error) return { error: error.message };

  const { data: request } = await supabase.from("requests").select("company_id").eq("id", requestId).maybeSingle();
  if (request) revalidateMediaLibrary(request.company_id);
  return {};
}

export async function detachMediaFileFromRequest(requestId: string, mediaFileId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("request_media_files")
    .delete()
    .eq("request_id", requestId)
    .eq("media_file_id", mediaFileId);
  if (error) return { error: error.message };

  const { data: request } = await supabase.from("requests").select("company_id").eq("id", requestId).maybeSingle();
  if (request) revalidateMediaLibrary(request.company_id);
  return {};
}
