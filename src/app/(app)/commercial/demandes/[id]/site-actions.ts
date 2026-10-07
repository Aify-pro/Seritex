"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";

const schema = z.object({
  requestId: z.string().uuid(),
  companyId: z.string().uuid({ message: "Choisissez le client" }),
});

type Prospect = { nom?: string; email?: string; telephone?: string | null } | null;

/**
 * Demande du site web (migration 0098) : une fois le client créé dans Sage et
 * synchronisé, le commercial la rattache à sa fiche. Le prospect devient un
 * contact du client (sauf s'il y figure déjà avec le même e-mail) ; la demande
 * suit ensuite le circuit normal jusqu'au devis.
 */
export async function linkSiteRequestToCompany(requestId: string, companyId: string) {
  await requirePermission("demandes", "modify");
  const parsed = schema.safeParse({ requestId, companyId });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("id,company_id,prospect")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (!request) return { error: "Demande introuvable" };
  if (request.company_id) return { error: "Cette demande est déjà rattachée à un client." };

  const prospect = request.prospect as Prospect;
  let contactId: string | null = null;
  if (prospect?.email) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("company_id", parsed.data.companyId)
      .ilike("email", prospect.email)
      .limit(1)
      .maybeSingle();
    if (existing) {
      contactId = existing.id as string;
    } else {
      const [first, ...rest] = (prospect.nom ?? "").trim().split(/\s+/);
      const { data: created, error } = await supabase
        .from("contacts")
        .insert({
          company_id: parsed.data.companyId,
          first_name: first || "—",
          last_name: rest.join(" ") || "—",
          email: prospect.email,
          phone: prospect.telephone ?? null,
        })
        .select("id")
        .single();
      if (error) return { error: `Contact non créé : ${error.message}` };
      contactId = created.id as string;
    }
  }

  const { error } = await supabase
    .from("requests")
    .update({ company_id: parsed.data.companyId, contact_id: contactId })
    .eq("id", parsed.data.requestId)
    .is("company_id", null);
  if (error) return { error: error.message };

  revalidatePath("/commercial/demandes", "layout");
  return { ok: true };
}
