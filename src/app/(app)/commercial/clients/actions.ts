"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DROITS_CLIENT_CLES } from "@/lib/clients/droits";

const companySchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  siret: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  notes: z.string().trim().optional(),
  // Identifiants légaux ivoiriens (migration 0061) : champs CRM, éditables
  // même sur une fiche Sage (hors périmètre protégé du trigger 0059).
  ncc: z.string().trim().max(50).optional(),
  rccm: z.string().trim().max(50).optional(),
});

/** Met à jour la fiche entreprise (coordonnées, SIRET, notes CRM) — notes et NCC/RCCM seuls pour une fiche Sage. */
export async function updateCompany(formData: FormData) {
  await requirePermission("clients", "modify");
  const parsed = companySchema.safeParse({
    company_id: formData.get("company_id"),
    name: formData.get("name"),
    siret: formData.get("siret"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
    ncc: formData.get("ncc") ?? undefined,
    rccm: formData.get("rccm") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const legalIds = { ncc: parsed.data.ncc || null, rccm: parsed.data.rccm || null };

  // Fiche importée de Sage : identité et coordonnées appartiennent à Sage
  // (migration 0059, protégées aussi par un trigger) — seules les notes CRM
  // sont modifiables ici, quoi que le formulaire envoie.
  const { data: existing } = await supabase.from("companies").select("origin").eq("id", parsed.data.company_id).maybeSingle();
  if (!existing) return { error: "Fiche entreprise introuvable" };

  const { error } = await supabase
    .from("companies")
    .update(
      existing.origin === "sage"
        ? { notes: parsed.data.notes || null, ...legalIds }
        : {
            name: parsed.data.name,
            siret: parsed.data.siret || null,
            address: parsed.data.address || null,
            phone: parsed.data.phone || null,
            email: parsed.data.email || null,
            notes: parsed.data.notes || null,
            ...legalIds,
          }
    )
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
  await requirePermission("clients", "modify");
  const parsed = contactSchema.safeParse({
    // Absent du formulaire à la création (champ caché uniquement en modification) :
    // `get` renvoie alors null, que le schéma refuserait — d'où « Invalid input ».
    contact_id: formData.get("contact_id") ?? "",
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
  await requirePermission("clients", "modify");
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
  await requirePermission("clients", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update({ status }).eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath(`/commercial/clients/${companyId}`);
  return {};
}

const compteSchema = z.object({ user_id: z.string().uuid(), company_id: z.string().uuid().optional() });

/**
 * Comptes créés sur le site (migration 0125) : rattache le compte à une société
 * venue de Sage — un contact est créé dans cette société, au nom du compte.
 */
export async function rattacherCompteB2B(userId: string, companyId: string) {
  await requirePermission("clients", "modify");
  const parsed = compteSchema.safeParse({ user_id: userId, company_id: companyId });
  if (!parsed.success || !parsed.data.company_id) return { error: "Compte ou société invalide" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("attach_site_account_b2b", { p_user: parsed.data.user_id, p_company: parsed.data.company_id });
  if (error) return { error: error.message };
  revalidatePath("/commercial/clients/a-rattacher");
  revalidatePath("/commercial/clients");
  return {};
}

/** Comptes créés sur le site : crée la fiche particulier (hors Sage) et y rattache le compte. */
export async function rattacherCompteB2C(userId: string) {
  await requirePermission("clients", "create");
  const parsed = compteSchema.safeParse({ user_id: userId });
  if (!parsed.success) return { error: "Compte invalide" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attach_site_account_b2c", { p_user: parsed.data.user_id });
  if (error) return { error: error.message };
  revalidatePath("/commercial/clients/a-rattacher");
  revalidatePath("/commercial/clients");
  return { companyId: data as string };
}

const idSchema = z.string().uuid();

/**
 * Migration 0133 : le client particulier (B2C) devient contact d'une entreprise.
 * Sa fiche et son historique sont conservés, seuls le contact et son compte portail déménagent.
 */
export async function rattacherB2CAEntreprise(b2cId: string, companyId: string) {
  await requirePermission("clients", "modify");
  if (!idSchema.safeParse(b2cId).success || !idSchema.safeParse(companyId).success) return { error: "Fiche invalide" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("attach_b2c_to_company", { p_b2c: b2cId, p_company: companyId });
  if (error) return { error: error.message };
  revalidatePath(`/commercial/clients/${b2cId}`);
  revalidatePath(`/commercial/clients/${companyId}`);
  revalidatePath("/commercial/clients");
  return {};
}

/** Migration 0133 : le contact quitte son entreprise et devient un client particulier (B2C). */
export async function detacherContactEnB2C(contactId: string, companyId: string) {
  await requirePermission("clients", "modify");
  await requirePermission("clients", "create");
  if (!idSchema.safeParse(contactId).success) return { error: "Contact invalide" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("detach_contact_to_b2c", { p_contact: contactId });
  if (error) return { error: error.message };
  revalidatePath(`/commercial/clients/${companyId}`);
  revalidatePath("/commercial/clients");
  return { b2cId: data as string };
}

const droitSchema = z.object({
  company_id: z.string().uuid(),
  droit: z.string().refine((d) => DROITS_CLIENT_CLES.includes(d), "Droit inconnu"),
  autorise: z.boolean(),
  user_id: z.string().uuid().nullable(),
});

/**
 * Migration 0140 : droits de l'espace client. Sans `userId`, règle la société (false = retiré à tous ses comptes).
 * Avec `userId`, règle ce compte : false = restreint, true = hérite de sa société (jamais plus que sa société).
 */
export async function definirDroitClient(companyId: string, droit: string, autorise: boolean, userId: string | null = null) {
  await requirePermission("clients", "modify");
  const parsed = droitSchema.safeParse({ company_id: companyId, droit, autorise, user_id: userId });
  if (!parsed.success) return { error: "Droit invalide" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("definir_droit_client", {
    p_company: parsed.data.company_id,
    p_droit: parsed.data.droit,
    p_autorise: parsed.data.autorise,
    p_user: parsed.data.user_id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/commercial/clients/${companyId}`);
  return {};
}
