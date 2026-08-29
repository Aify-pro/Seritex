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
