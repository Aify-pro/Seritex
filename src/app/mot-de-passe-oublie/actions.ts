"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordLinkEmail } from "@/lib/notifications/account";

export type ForgotState = { error?: string; done?: boolean };

const schema = z.object({ email: z.string().trim().email("Adresse e-mail invalide") });

/** Un même compte ne reçoit pas plus d'un lien toutes les 2 minutes. */
const THROTTLE_MS = 2 * 60 * 1000;

/**
 * Demande de lien de réinitialisation, ouverte sans session. Répond TOUJOURS
 * la même chose que le compte existe, soit actif ou non : sinon l'écran
 * révélerait quelles adresses ont un compte (énumération). L'e-mail n'est
 * envoyé qu'à une adresse trouvée dans app_users et jamais à celle saisie
 * telle quelle ; un compte désactivé ne reçoit rien.
 */
export async function requestPasswordResetAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Adresse e-mail invalide" };

  try {
    const admin = createAdminClient();
    // ilike : l'adresse stockée peut avoir une casse différente de la saisie ;
    // on échappe les jokers pour que « a_b@x.com » ne joue pas le motif.
    const pattern = parsed.data.email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: user } = await admin
      .from("app_users")
      .select("email, full_name, active")
      .ilike("email", pattern)
      .maybeSingle();

    if (user?.active) {
      const since = new Date(Date.now() - THROTTLE_MS).toISOString();
      const { count } = await admin
        .from("notification_log")
        .select("id", { count: "exact", head: true })
        .eq("event_key", "mot_de_passe_reinitialisation")
        .eq("recipient_email", user.email)
        .gte("created_at", since);

      if ((count ?? 0) === 0) {
        await sendPasswordLinkEmail("reinitialisation", user, { useServiceRole: true });
      }
    }
  } catch (err) {
    // Jamais de différence visible entre « échec interne » et « compte inconnu ».
    console.error("[compte] requestPasswordResetAction :", err);
  }

  return { done: true };
}
