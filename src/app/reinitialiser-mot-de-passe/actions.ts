"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passwordSchema } from "@/lib/auth/password";
import { sendPasswordChangedEmail } from "@/lib/notifications/account";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery";
import type { PasswordFormState } from "@/components/auth/new-password-form";

/**
 * Définit le nouveau mot de passe SANS demander l'ancien — c'est ce qui
 * distingue ce chemin de Mon compte. Il n'est donc ouvert que si l'utilisateur
 * a prouvé sa légitimité : soit il vient de cliquer un lien e-mail (cookie
 * posé par /auth/confirm), soit son compte exige un changement
 * (`must_change_password`). Une session ordinaire seule ne suffit pas.
 */
export async function setNewPasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée : redemandez un lien de réinitialisation." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("app_users")
    .select("email, full_name, active, must_change_password")
    .eq("id", user.id)
    .single();
  const jar = await cookies();
  const viaLink = jar.get(RECOVERY_COOKIE)?.value === "1";
  if (!profile?.active || !(viaLink || profile.must_change_password)) {
    return { error: "Cette action n'est pas autorisée. Utilisez « Mon compte » pour changer votre mot de passe." };
  }

  const password = formData.get("password");
  if (password !== formData.get("confirm")) return { error: "Les deux mots de passe ne correspondent pas." };
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Mot de passe invalide" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.message };

  await admin
    .from("app_users")
    .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
    .eq("id", user.id);
  jar.delete(RECOVERY_COOKIE);
  await sendPasswordChangedEmail(profile);

  redirect("/dashboard");
}
