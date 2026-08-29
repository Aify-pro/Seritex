"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/current-user";
import type { RequestStatus } from "@/lib/types/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function updateRequestStatus(requestId: string, status: RequestStatus) {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const { data: current } = await supabase.from("requests").select("status").eq("id", requestId).single();

  const { error } = await supabase.from("requests").update({ status }).eq("id", requestId);
  if (error) return { error: error.message };

  await supabase.from("status_history").insert({
    entity_type: "request",
    entity_id: requestId,
    from_status: current?.status ?? null,
    to_status: status,
  });

  revalidatePath(`/commercial/demandes/${requestId}`);
  revalidatePath("/commercial/demandes");
  return {};
}

const quoteLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  unit_price: z.coerce.number().nonnegative(),
  product_model_id: z.string().uuid().optional().or(z.literal("")),
});

export async function createQuote(requestId: string, companyId: string, formData: FormData) {
  await requireRole(["commercial", "administrateur"]);
  const parsed = quoteLineSchema.safeParse({
    description: formData.get("description"),
    quantity: formData.get("quantity"),
    unit_price: formData.get("unit_price"),
    product_model_id: formData.get("product_model_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const reference = "DEV-" + Date.now().toString(36).toUpperCase();

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      reference,
      request_id: requestId,
      company_id: companyId,
      status: "envoye",
      total_amount: parsed.data.quantity * parsed.data.unit_price,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  await supabase.from("quote_lines").insert({
    quote_id: quote.id,
    product_model_id: parsed.data.product_model_id || null,
    description: parsed.data.description,
    quantity: parsed.data.quantity,
    unit_price: parsed.data.unit_price,
  });

  await supabase.from("requests").update({ status: "devis_envoye" }).eq("id", requestId);

  revalidatePath(`/commercial/demandes/${requestId}`);
  revalidatePath("/commercial/devis");
  return { quoteId: quote.id as string };
}

const newRequestSchema = z.object({
  company_id: z.string().uuid(),
  contact_id: z.string().uuid().optional().or(z.literal("")),
  description: z.string().min(1, "Merci de décrire le besoin"),
  needs_graphics: z.coerce.boolean().optional(),
});

export async function createRequest(formData: FormData) {
  const { authId } = await requireRole(["commercial", "administrateur"]);
  const parsed = newRequestSchema.safeParse({
    company_id: formData.get("company_id"),
    contact_id: formData.get("contact_id"),
    description: formData.get("description"),
    needs_graphics: formData.get("needs_graphics") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const reference = "REQ-" + Date.now().toString(36).toUpperCase();

  const { data, error } = await supabase
    .from("requests")
    .insert({
      reference,
      company_id: parsed.data.company_id,
      contact_id: parsed.data.contact_id || null,
      description: parsed.data.description,
      needs_graphics: parsed.data.needs_graphics ?? false,
      assigned_commercial_id: authId,
      source: "manuel",
      created_by: authId,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  revalidatePath("/commercial/demandes");
  return { requestId: data.id as string };
}

export async function acceptQuote(quoteId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_quote", { p_quote_id: quoteId });
  if (error) return { error: error.message };

  revalidatePath("/commercial/devis");
  revalidatePath("/client/devis");
  revalidatePath("/atelier/production");
  return { productionOrderId: data as string };
}
