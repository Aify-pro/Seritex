import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { NotificationRecipient, UserRole } from "@/lib/types/domain";

/**
 * Contact destinataire d'une demande précise : priorité au contact
 * rattaché à CETTE demande (`requests.contact_id`, s'il a un email), sinon
 * le contact principal de l'entreprise (`contacts.is_primary_contact`),
 * sinon le premier contact de l'entreprise ayant un email. `[]` si
 * l'entreprise n'a aucun contact exploitable — jamais de repli sur
 * `companies.email` (les emails de notification viennent des contacts de
 * l'app, jamais de Sage, décision explicite).
 */
export async function resolveContactEmailForRequest(requestId: string, companyId: string): Promise<NotificationRecipient[]> {
  const supabase = await createClient();

  const { data: request } = await supabase.from("requests").select("contact_id").eq("id", requestId).maybeSingle();
  if (request?.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, first_name, last_name")
      .eq("id", request.contact_id)
      .maybeSingle();
    if (contact?.email) {
      return [{ email: contact.email, label: `${contact.first_name} ${contact.last_name}`.trim() }];
    }
  }

  const { data: contacts } = await supabase
    .from("contacts")
    .select("email, first_name, last_name, is_primary_contact")
    .eq("company_id", companyId)
    .not("email", "is", null)
    .order("is_primary_contact", { ascending: false });

  const contact = contacts?.[0];
  if (!contact?.email) return [];
  return [{ email: contact.email, label: `${contact.first_name} ${contact.last_name}`.trim() }];
}

/** Tous les app_users actifs de ce rôle — pour les événements de diffusion d'équipe. */
export async function resolveRoleEmails(role: UserRole): Promise<NotificationRecipient[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("email, full_name").eq("role", role).eq("active", true);
  return (data ?? []).map((u) => ({ email: u.email, label: u.full_name }));
}

/** Un utilisateur précis — `[]` s'il est désactivé (personne n'est notifié pour un compte désactivé). */
export async function resolveUserEmail(userId: string): Promise<NotificationRecipient[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("email, full_name").eq("id", userId).eq("active", true).maybeSingle();
  if (!data) return [];
  return [{ email: data.email, label: data.full_name }];
}
