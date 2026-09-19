import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "./send";

/**
 * Notifications du cycle de vie d'un compte (migration 0055). Toutes passent
 * par sendNotification : journalisées, désactivables et éditables depuis
 * Paramètres > Notifications comme les autres événements.
 */

type Person = { email: string; full_name: string };

/** URL publique de l'application : réglage de marque, sinon l'hôte de la requête. */
export async function getAppBaseUrl(): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_style_settings").select("app_base_url").limit(1).maybeSingle();
  const configured = data?.app_base_url?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Lien à usage unique qui ouvre une session de récupération de mot de passe.
 * Il pointe vers /auth/confirm (une page avec bouton, pas un GET qui consomme
 * le jeton) : les antivirus et aperçus de liens des messageries ouvrent les
 * URL avant l'utilisateur et grilleraient sinon un jeton à usage unique.
 */
export async function createPasswordLink(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[compte] generateLink a échoué :", error?.message);
    return null;
  }
  const base = await getAppBaseUrl();
  return `${base}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

/** Invitation (compte créé / renvoyée) ou réinitialisation : même lien, deux messages. */
export async function sendPasswordLinkEmail(
  kind: "invitation" | "reinitialisation",
  person: Person,
  opts: { roleLabel?: string; useServiceRole?: boolean } = {}
): Promise<{ sent: boolean }> {
  const link = await createPasswordLink(person.email);
  if (!link) return { sent: false };

  const result = await sendNotification(kind === "invitation" ? "compte_cree" : "mot_de_passe_reinitialisation", {
    to: [{ email: person.email, label: person.full_name }],
    variables: { nom_utilisateur: person.full_name, role: opts.roleLabel ?? "", lien_action: link },
    relatedEntityType: "app_user",
    useServiceRole: opts.useServiceRole,
  });
  return { sent: result.sent > 0 };
}

export async function sendPasswordChangedEmail(person: Person) {
  const dateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date());
  return sendNotification("mot_de_passe_modifie", {
    to: [{ email: person.email, label: person.full_name }],
    variables: { nom_utilisateur: person.full_name, date_heure: dateHeure },
    relatedEntityType: "app_user",
  });
}

/** `changes` : phrases courtes, une par changement (« Rôle : Commercial → Direction »). */
export async function sendAccountUpdatedEmail(person: Person, changes: string[]) {
  if (changes.length === 0) return { attempted: 0, sent: 0, skipped: true };
  return sendNotification("compte_modifie", {
    to: [{ email: person.email, label: person.full_name }],
    variables: { nom_utilisateur: person.full_name, modifications: changes.join(" ; ") },
    relatedEntityType: "app_user",
  });
}

/** Resend est-il réellement branché ? Sinon sendNotification « simule » : aucun e-mail ne part. */
export function isEmailDeliveryConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}
