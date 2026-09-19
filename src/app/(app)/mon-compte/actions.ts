"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passwordSchema } from "@/lib/auth/password";
import { sendPasswordChangedEmail } from "@/lib/notifications/account";
import type { PasswordFormState } from "@/components/auth/new-password-form";

export type ProfileFormState = { error?: string; success?: boolean };

const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Le nom est requis").max(100),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\-\s]*$/, "Numéro de téléphone invalide")
    .optional(),
  job_title: z.string().trim().max(100).optional(),
});

/**
 * Le titulaire modifie SES coordonnées. Client authentifié (pas service_role) :
 * la RLS restreint à la ligne du compte et le grant de colonnes (migration
 * 0055) borne l'écriture à nom, téléphone et fonction — ni rôle, ni e-mail.
 */
export async function updateMyProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const { authId } = await requireUser();
  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone") ?? undefined,
    job_title: formData.get("job_title") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_users")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      job_title: parsed.data.job_title || null,
    })
    .eq("id", authId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

/**
 * Changement de mot de passe depuis une session ouverte : l'ancien mot de
 * passe est exigé, pour qu'une session laissée ouverte sur un poste partagé
 * ne suffise pas à prendre le compte. La vérification passe par un client
 * éphémère qui ne persiste rien, pour ne pas réécrire les cookies de session.
 */
export async function changeMyPasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const { authId, profile } = await requireUser();

  const current = formData.get("current_password");
  const password = formData.get("password");
  if (typeof current !== "string" || !current) return { error: "Saisissez votre mot de passe actuel." };
  if (password !== formData.get("confirm")) return { error: "Les deux mots de passe ne correspondent pas." };
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Mot de passe invalide" };
  if (parsed.data === current) return { error: "Le nouveau mot de passe doit être différent de l'actuel." };

  const probe = createBareClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await probe.auth.signInWithPassword({ email: profile.email, password: current });
  if (verifyError) return { error: "Le mot de passe actuel est incorrect." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.message };

  await createAdminClient()
    .from("app_users")
    .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
    .eq("id", authId);
  await sendPasswordChangedEmail(profile);

  revalidatePath("/mon-compte");
  return { success: true };
}

/** Ferme la session sur TOUS les appareils (y compris celui-ci). */
export async function signOutEverywhereAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
