"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const companySchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  siret: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  notes: z.string().trim().optional(),
});

/** Met à jour la fiche entreprise (coordonnées, SIRET, notes CRM). */
export async function updateCompany(formData: FormData) {
  await requireRole(["commercial", "administrateur"]);
  const parsed = companySchema.safeParse({
    company_id: formData.get("company_id"),
    name: formData.get("name"),
    siret: formData.get("siret"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({
      name: parsed.data.name,
      siret: parsed.data.siret || null,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
    })
    .eq("id", parsed.data.company_id);
  if (error) return { error: error.message };

  revalidatePath(`/commercial/clients/${parsed.data.company_id}`);
  return {};
}

const contactSchema = z.object({
  contact_id: z.string().uuid().optional().or(z.literal("")),
  company_id: z.string().uuid(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  mobile_phone: z.string().trim().optional(),
  role_title: z.string().trim().optional(),
  department: z.string().trim().optional(),
  preferred_channel: z.enum(["email", "telephone", "whatsapp"]).default("email"),
  notes: z.string().trim().optional(),
});

/**
 * Crée ou met à jour une fiche contact CRM — c'est cette fiche, désormais,
 * qu'un compte utilisateur de rôle client représente (`app_users.contact_id`),
 * plutôt qu'un simple rattachement à l'entreprise seule.
 */
export async function upsertContact(formData: FormData) {
  await requireRole(["commercial", "administrateur"]);
  const parsed = contactSchema.safeParse({
    contact_id: formData.get("contact_id"),
    company_id: formData.get("company_id"),
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    mobile_phone: formData.get("mobile_phone"),
    role_title: formData.get("role_title"),
    department: formData.get("department"),
    preferred_channel: formData.get("preferred_channel") || "email",
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const payload = {
    company_id: parsed.data.company_id,
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    mobile_phone: parsed.data.mobile_phone || null,
    role_title: parsed.data.role_title || null,
    department: parsed.data.department || null,
    preferred_channel: parsed.data.preferred_channel,
    notes: parsed.data.notes || null,
  };

  const { error } = parsed.data.contact_id
    ? await supabase.from("contacts").update(payload).eq("id", parsed.data.contact_id)
    : await supabase.from("contacts").insert(payload);
  if (error) return { error: error.message };

  revalidatePath(`/commercial/clients/${parsed.data.company_id}`);
  return {};
}

export async function setPrimaryContact(contactId: string, companyId: string) {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  // Un seul contact principal par entreprise (index unique en base) : on
  // retire d'abord le drapeau des autres contacts de la même entreprise.
  await supabase.from("contacts").update({ is_primary_contact: false }).eq("company_id", companyId);
  const { error } = await supabase.from("contacts").update({ is_primary_contact: true }).eq("id", contactId);
  if (error) return { error: error.message };

  revalidatePath(`/commercial/clients/${companyId}`);
  return {};
}

export async function toggleContactStatus(contactId: string, companyId: string, status: "actif" | "inactif") {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update({ status }).eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath(`/commercial/clients/${companyId}`);
  return {};
}
