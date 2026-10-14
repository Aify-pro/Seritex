import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationRecipient, UserRole } from "@/lib/types/domain";

/**
 * Contact principal d'une entreprise (`contacts.is_primary_contact`), sinon
 * le premier contact de l'entreprise ayant un email. `[]` si aucun contact
 * exploitable — jamais de repli sur `companies.email` (les emails de
 * notification viennent des contacts de l'app, jamais de Sage, décision
 * explicite).
 */
export async function resolveContactEmailForCompany(companyId: string): Promise<NotificationRecipient[]> {
  const supabase = await createClient();
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

/**
 * Contact destinataire d'une demande précise : priorité au contact
 * rattaché à CETTE demande (`requests.contact_id`, s'il a un email), sinon
 * le contact principal de l'entreprise.
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

  return resolveContactEmailForCompany(companyId);
}

/**
 * Contact destinataire d'un ordre de fabrication : remonte à la demande
 * d'origine via son devis (production_orders.quote_id -> quotes.request_id)
 * pour privilégier le contact précis de cette demande, sinon retombe sur le
 * contact principal de l'entreprise. `[]` si l'ODF n'a pas de devis d'origine
 * (ex. données de démo) ET que l'entreprise n'a aucun contact exploitable.
 */
export async function resolveContactEmailForProductionOrder(productionOrderId: string): Promise<NotificationRecipient[]> {
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("production_orders")
    .select("company_id, quotes(request_id)")
    .eq("id", productionOrderId)
    .maybeSingle();
  // ODF de stock (SF-3) : pas de client, donc aucune notification client.
  if (!po || !po.company_id) return [];

  const requestId = (po.quotes as unknown as { request_id: string } | null)?.request_id;
  if (requestId) return resolveContactEmailForRequest(requestId, po.company_id);
  return resolveContactEmailForCompany(po.company_id);
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

// ----------------------------------------------------------------------------
// Destinataires CONFIGURÉS (Paramètres > Notifications, migration 0129).
// Lus avec la clé de service : ils sont résolus côté serveur, jamais saisis par l'appelant.
// ----------------------------------------------------------------------------

export type RecipientContext = { requestId?: string | null; companyId?: string | null };

type RecipientRow = { kind: "user" | "role" | "responsable_dossier" | "contact_client"; user_id: string | null; role_key: string | null };

const unique = (list: NotificationRecipient[]) => {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = r.email.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

type Personne = { email: string; full_name: string };
const versDestinataires = (l: Personne[] | null): NotificationRecipient[] => (l ?? []).map((u) => ({ email: u.email, label: u.full_name }));

/**
 * Destinataires configurés pour un événement. `configured` = false si l'administrateur n'a rien réglé
 * (l'appelant applique alors le comportement par défaut de son événement).
 */
export async function resolveConfiguredRecipients(
  eventKey: string,
  ctx: RecipientContext = {},
): Promise<{ configured: boolean; recipients: NotificationRecipient[] }> {
  const db = createAdminClient();
  const { data: rows } = await db.from("notification_recipients").select("kind, user_id, role_key").eq("event_key", eventKey);
  const regles = (rows ?? []) as RecipientRow[];
  if (regles.length === 0) return { configured: false, recipients: [] };

  const utilisateur = async (id: string) =>
    versDestinataires((await db.from("app_users").select("email, full_name").eq("active", true).eq("id", id)).data);
  const commerciaux = async () =>
    versDestinataires((await db.from("app_users").select("email, full_name").eq("active", true).eq("role", "commercial")).data);
  const contactsDe = async (companyId: string) => {
    const { data } = await db
      .from("contacts")
      .select("email, first_name, last_name")
      .eq("company_id", companyId)
      .not("email", "is", null)
      .order("is_primary_contact", { ascending: false })
      .limit(1);
    return (data ?? []).filter((c) => c.email).map((c) => ({ email: c.email as string, label: `${c.first_name} ${c.last_name}`.trim() }));
  };

  const out: NotificationRecipient[] = [];
  for (const r of regles) {
    if (r.kind === "user" && r.user_id) {
      out.push(...(await utilisateur(r.user_id)));
    } else if (r.kind === "role" && r.role_key) {
      const { data: role } = await db.from("roles").select("id").eq("key", r.role_key).maybeSingle();
      if (role) out.push(...versDestinataires((await db.from("app_users").select("email, full_name").eq("active", true).eq("role_id", role.id)).data));
    } else if (r.kind === "responsable_dossier") {
      let responsable: NotificationRecipient[] = [];
      if (ctx.requestId) {
        const { data: req } = await db.from("requests").select("assigned_commercial_id").eq("id", ctx.requestId).maybeSingle();
        if (req?.assigned_commercial_id) responsable = await utilisateur(req.assigned_commercial_id);
      }
      // Pas de commercial affecté : toute l'équipe commerciale est prévenue (un message client ne doit pas rester sans lecteur).
      out.push(...(responsable.length ? responsable : await commerciaux()));
    } else if (r.kind === "contact_client") {
      let companyId = ctx.companyId ?? null;
      if (ctx.requestId) {
        const { data: req } = await db.from("requests").select("contact_id, company_id").eq("id", ctx.requestId).maybeSingle();
        companyId = companyId ?? req?.company_id ?? null;
        if (req?.contact_id) {
          const { data: c } = await db.from("contacts").select("email, first_name, last_name").eq("id", req.contact_id).maybeSingle();
          if (c?.email) {
            out.push({ email: c.email, label: `${c.first_name} ${c.last_name}`.trim() });
            continue;
          }
        }
      }
      if (companyId) out.push(...(await contactsDe(companyId)));
    }
  }
  return { configured: true, recipients: unique(out) };
}
