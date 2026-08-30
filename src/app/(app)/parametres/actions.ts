"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newUserSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  role: z.enum([
    "client",
    "commercial",
    "infographiste",
    "responsable_production",
    "chef_section",
    "administrateur",
  ]),
  company_id: z.string().uuid().optional().or(z.literal("")),
  section_id: z.string().uuid().optional().or(z.literal("")),
  contact_id: z.string().uuid().optional().or(z.literal("")),
});

/**
 * Création de compte utilisateur — action réservée à l'administrateur.
 * `requireRole` s'exécute AVANT tout usage du client admin (service_role) :
 * on ne construit jamais ce client privilégié pour un appelant non vérifié.
 */
export async function createUserAccount(formData: FormData) {
  await requireRole(["administrateur"]);

  const parsed = newUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    company_id: formData.get("company_id"),
    section_id: formData.get("section_id"),
    contact_id: formData.get("contact_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (parsed.data.role === "client" && !parsed.data.company_id) {
    return { error: "Une entreprise est requise pour un compte client" };
  }
  // (v4) Un compte client représente désormais une vraie fiche contact CRM,
  // pas seulement l'entreprise — cf. addendum v4 de l'analyse fonctionnelle.
  if (parsed.data.role === "client" && !parsed.data.contact_id) {
    return { error: "Un contact (fiche CRM) est requis pour un compte client — créez-le d'abord depuis Clients." };
  }
  if (parsed.data.role === "chef_section" && !parsed.data.section_id) {
    return { error: "Une section est requise pour un chef de section" };
  }

  const admin = createAdminClient();
  const tempPassword = crypto.randomUUID().slice(0, 12) + "Aa1!";

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });
  if (createError) return { error: createError.message };

  // `app_users.role` reste écrit ici directement (compatibilité avec le
  // flux de création existant) ; le trigger `trg_sync_app_user_role`
  // n'intervient que lorsqu'on écrit `role_id` — voir la page Rôles &
  // permissions pour réattribuer un rôle personnalisé après création.
  const { data: roleRow } = await admin.from("roles").select("id").eq("key", parsed.data.role).single();

  const { error: profileError } = await admin.from("app_users").insert({
    id: created.user.id,
    email: parsed.data.email,
    full_name: parsed.data.full_name,
    role: parsed.data.role,
    role_id: roleRow?.id,
    company_id: parsed.data.company_id || null,
    section_id: parsed.data.section_id || null,
    contact_id: parsed.data.contact_id || null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/parametres/utilisateurs");
  return { tempPassword, email: parsed.data.email };
}

export async function toggleUserActive(userId: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ active }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/utilisateurs");
  return {};
}

const newSectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function createSection(formData: FormData) {
  await requireRole(["administrateur"]);
  const parsed = newSectionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: max } = await supabase
    .from("sections")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .single();

  const { error } = await supabase.from("sections").insert({
    name: parsed.data.name,
    description: parsed.data.description || null,
    display_order: (max?.display_order ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

export async function toggleSectionActive(sectionId: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sections").update({ active }).eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

const newTemplateSchema = z.object({ name: z.string().min(1) });

export async function createRoutingTemplate(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newTemplateSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routing_templates")
    .insert({ name: parsed.data.name })
    .select()
    .single();
  if (error) return { error: error.message };
  revalidatePath("/parametres/gammes");
  return { id: data.id as string };
}

const newStepSchema = z.object({
  routing_template_id: z.string().uuid(),
  section_id: z.string().uuid(),
  standard_duration_minutes: z.coerce.number().int().positive().optional(),
  instructions: z.string().optional(),
});

export async function addRoutingStep(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newStepSchema.safeParse({
    routing_template_id: formData.get("routing_template_id"),
    section_id: formData.get("section_id"),
    standard_duration_minutes: formData.get("standard_duration_minutes"),
    instructions: formData.get("instructions"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: existingSteps } = await supabase
    .from("routing_steps")
    .select("id,sequence_order")
    .eq("routing_template_id", parsed.data.routing_template_id)
    .order("sequence_order", { ascending: false })
    .limit(1);

  const lastStep = existingSteps?.[0];

  const { error } = await supabase.from("routing_steps").insert({
    routing_template_id: parsed.data.routing_template_id,
    section_id: parsed.data.section_id,
    sequence_order: (lastStep?.sequence_order ?? 0) + 1,
    depends_on_step_id: lastStep?.id ?? null,
    standard_duration_minutes: parsed.data.standard_duration_minutes ?? null,
    instructions: parsed.data.instructions || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/gammes");
  return {};
}

/**
 * Simule un cycle de synchronisation du miroir de stock Sage (section 7.1b).
 * En production, ce serait un job planifié utilisant un compte technique
 * Sage à droits lecture seule — jamais déclenché depuis une session
 * utilisateur normale. Conservé ici en lecture/démo uniquement, réservé à
 * l'administrateur, pour illustrer le mécanisme sans connecter un vrai Sage.
 */
export async function simulateStockSync() {
  await requireRole(["administrateur"]);
  // stock_item_view n'a volontairement AUCUNE policy d'écriture pour les
  // rôles applicatifs (cf. 0002_rls.sql) : seul un job technique via
  // service_role peut y écrire, jamais une session utilisateur normale même
  // administrateur. On utilise donc le client admin ici, uniquement après
  // vérification du rôle ci-dessus, pour simuler ce job de synchronisation.
  const admin = createAdminClient();
  const { data: items } = await admin.from("stock_item_view").select("sage_reference,quantity_available");

  for (const item of items ?? []) {
    const delta = Math.round((Math.random() - 0.5) * 20 * 10) / 10;
    await admin
      .from("stock_item_view")
      .update({
        quantity_available: Math.max(0, item.quantity_available + delta),
        last_sync_at: new Date().toISOString(),
      })
      .eq("sage_reference", item.sage_reference);
  }
  revalidatePath("/parametres/stock");
  return {};
}
