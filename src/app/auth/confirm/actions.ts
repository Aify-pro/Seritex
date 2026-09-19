"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery";

/**
 * Échange le jeton du lien e-mail contre une session. Déclenché par le bouton
 * de la page /auth/confirm, jamais par un simple GET (voir createPasswordLink).
 */
export async function confirmRecoveryAction(formData: FormData) {
  const tokenHash = formData.get("token_hash");
  if (typeof tokenHash !== "string" || !tokenHash) redirect("/mot-de-passe-oublie?erreur=lien_invalide");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) redirect("/mot-de-passe-oublie?erreur=lien_invalide");

  (await cookies()).set(RECOVERY_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
  redirect("/reinitialiser-mot-de-passe");
}
