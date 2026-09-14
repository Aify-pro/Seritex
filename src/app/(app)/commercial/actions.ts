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
  description: z.string().min(1, "Description requise"),
  quantity: z.coerce.number().int().positive("Quantité invalide"),
  unit_price: z.coerce.number().nonnegative("Prix invalide"),
  product_model_id: z.string().uuid().nullable(),
  // Configuration couleur — la « maquette » que le client valide avec le
  // devis (chantier config-produit-devis). Jamais les deux ensemble :
  // couleur_unique_id pour un modèle « uni », zone_colors sinon.
  couleur_unique_id: z.string().uuid().nullable(),
  zone_colors: z.array(z.object({ zone_key: z.string().min(1), color_id: z.string().uuid() })),
});

const createQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1, "Au moins un article est requis"),
});

export type QuoteLineInput = z.infer<typeof quoteLineSchema>;

/**
 * Un devis peut porter plusieurs articles (`quote_lines` est une vraie
 * table enfant depuis le schéma initial — seule l'UI n'exposait qu'une
 * ligne). Écriture ligne à ligne, pas de RPC dédiée : même convention que
 * `setProductionOrderZoneColors` (écriture directe, autorisée par la RLS
 * pour commercial/administrateur).
 */
export async function createQuote(requestId: string, companyId: string, lines: QuoteLineInput[]) {
  await requireRole(["commercial", "administrateur"]);
  const parsed = createQuoteSchema.safeParse({ lines });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Devis invalide" };

  const supabase = await createClient();
  const reference = "DEV-" + Date.now().toString(36).toUpperCase();
  const totalAmount = parsed.data.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      reference,
      request_id: requestId,
      company_id: companyId,
      status: "envoye",
      total_amount: totalAmount,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  for (const line of parsed.data.lines) {
    const { data: quoteLine, error: lineError } = await supabase
      .from("quote_lines")
      .insert({
        quote_id: quote.id,
        product_model_id: line.product_model_id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        couleur_unique_id: line.couleur_unique_id,
      })
      .select("id")
      .single();
    if (lineError) return { error: lineError.message };

    if (!line.couleur_unique_id && line.zone_colors.length > 0) {
      const { error: zoneError } = await supabase.from("quote_line_zone_colors").insert(
        line.zone_colors.map((z) => ({ quote_line_id: quoteLine.id, zone_key: z.zone_key, color_id: z.color_id }))
      );
      if (zoneError) return { error: zoneError.message };
    }
  }

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
