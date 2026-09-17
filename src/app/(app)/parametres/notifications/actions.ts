"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sendNotification } from "@/lib/notifications/send";

export async function toggleNotificationEvent(id: string, enabled: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("notification_events").update({ enabled }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/parametres/notifications");
  return {};
}

const templateSchema = z.object({
  subject_template: z.string().min(1, "Le sujet ne peut pas être vide"),
  body_template: z.string().min(1, "Le message ne peut pas être vide"),
});

export async function updateNotificationEventTemplate(id: string, formData: FormData) {
  const current = await requirePlatformAdmin();
  const parsed = templateSchema.safeParse({
    subject_template: formData.get("subject_template"),
    body_template: formData.get("body_template"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_events")
    .update({
      subject_template: parsed.data.subject_template,
      body_template: parsed.data.body_template,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/parametres/notifications");
  return {};
}

const styleSchema = z.object({
  sender_name: z.string().min(1, "Le nom d'expéditeur ne peut pas être vide"),
  sender_email: z.string().email("Adresse email invalide").optional().or(z.literal("")),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #rrggbb attendu)"),
  logo_url: z.string().url("URL invalide").optional().or(z.literal("")),
  footer_text: z.string().optional().or(z.literal("")),
  app_base_url: z.string().url("URL invalide").optional().or(z.literal("")),
});

export async function updateNotificationStyleSettings(id: string, formData: FormData) {
  const current = await requirePlatformAdmin();
  const parsed = styleSchema.safeParse({
    sender_name: formData.get("sender_name"),
    sender_email: formData.get("sender_email"),
    brand_color: formData.get("brand_color"),
    logo_url: formData.get("logo_url"),
    footer_text: formData.get("footer_text"),
    app_base_url: formData.get("app_base_url"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_style_settings")
    .update({
      sender_name: parsed.data.sender_name,
      sender_email: parsed.data.sender_email || null,
      brand_color: parsed.data.brand_color,
      logo_url: parsed.data.logo_url || null,
      footer_text: parsed.data.footer_text || null,
      app_base_url: parsed.data.app_base_url || null,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/parametres/notifications");
  return {};
}

/**
 * Envoie un email de test à l'administrateur courant, avec des valeurs
 * factices générées depuis `available_variables` — pour prévisualiser le
 * rendu (image de marque, variables) sans dépendre d'un vrai déclenchement
 * métier. `bypassEnabledCheck` : un test doit pouvoir vérifier le rendu
 * même sur un événement encore désactivé.
 */
export async function sendTestNotification(eventKey: string) {
  const current = await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("notification_events")
    .select("available_variables")
    .eq("event_key", eventKey)
    .maybeSingle();
  if (!event) return { error: "Événement introuvable." };

  const dummyVariables = Object.fromEntries(
    event.available_variables
      .split(",")
      .map((v: string) => v.trim())
      .filter(Boolean)
      .map((v: string) => [v, `Exemple ${v}`])
  );

  const result = await sendNotification(eventKey, {
    to: [{ email: current.profile.email, label: "Test administrateur" }],
    variables: dummyVariables,
    isTest: true,
    bypassEnabledCheck: true,
  });

  revalidatePath("/parametres/notifications");
  return result.sent > 0 ? {} : { error: "Envoi non confirmé — voir l'historique ci-dessous pour le détail." };
}
