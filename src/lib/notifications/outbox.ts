import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveConfiguredRecipients, type RecipientContext } from "./recipients";
import { sendNotification } from "./send";

/**
 * Vide la file des événements déclenchés par la base (migration 0129) : devis accepté, message d'un client…
 * Appelé chaque minute par /api/notifications/traiter. Chaque événement est réservé (claim_notification_outbox),
 * envoyé aux destinataires configurés dans Paramètres > Notifications, puis marqué traité. Un envoi qui échoue
 * est repris plus tard (délai croissant, 6 tentatives) ; un événement désactivé ou sans destinataire est
 * journalisé par sendNotification puis clos.
 */

type Ligne = { id: string; event_key: string; entity_type: string | null; entity_id: string | null; payload: Record<string, unknown>; attempts: number };
type Construit = { variables: Record<string, string>; ctx: RecipientContext; related?: { type: string; id: string } };

const nomSociete = (c: unknown) => (c as { name: string } | null)?.name ?? "";

async function construire(l: Ligne): Promise<Construit | null> {
  const db = createAdminClient();
  if (l.event_key === "devis_accepte") {
    const quoteId = String(l.payload.quote_id ?? l.entity_id ?? "");
    const [{ data: q }, { data: po }] = await Promise.all([
      db.from("quotes").select("reference, company_id, request_id, companies(name)").eq("id", quoteId).maybeSingle(),
      db.from("production_orders").select("id, reference").eq("quote_id", quoteId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!q) return null;
    return {
      variables: { numero_devis: q.reference, nom_client: nomSociete(q.companies), numero_odf: po?.reference ?? "" },
      ctx: { requestId: q.request_id, companyId: q.company_id },
      related: po ? { type: "production_order", id: po.id } : { type: "quote", id: quoteId },
    };
  }
  if (l.event_key === "message_client") {
    const messageId = String(l.payload.message_id ?? "");
    const { data: m } = await db.from("messages").select("body, request_id, sender_id").eq("id", messageId).maybeSingle();
    if (!m) return null;
    const [{ data: r }, { data: auteur }] = await Promise.all([
      db.from("requests").select("reference, company_id, companies(name)").eq("id", m.request_id).maybeSingle(),
      db.from("app_users").select("full_name").eq("id", m.sender_id).maybeSingle(),
    ]);
    if (!r) return null;
    const societe = nomSociete(r.companies);
    return {
      variables: {
        nom_client: [societe, auteur?.full_name].filter(Boolean).join(" — ") || "Un client",
        numero_demande: r.reference,
        extrait: m.body.length > 600 ? `${m.body.slice(0, 600)}…` : m.body,
        chemin_lien: `/commercial/demandes/${m.request_id}`,
      },
      ctx: { requestId: m.request_id, companyId: r.company_id },
      related: { type: "request", id: m.request_id },
    };
  }
  return null;
}

export async function traiterFile(limite = 20): Promise<{ reserves: number; envoyes: number; abandonnes: number; erreurs: number }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("claim_notification_outbox", { p_limit: limite });
  if (error) throw new Error(`file de notifications : ${error.message}`);
  const lignes = (data ?? []) as Ligne[];
  let envoyes = 0;
  let abandonnes = 0;
  let erreurs = 0;

  for (const l of lignes) {
    try {
      const c = await construire(l);
      if (!c) {
        // Donnée disparue (ex. message supprimé) : rien à envoyer, on clôt.
        await db.from("notification_outbox").update({ processed_at: new Date().toISOString(), last_error: "donnée introuvable" }).eq("id", l.id);
        abandonnes += 1;
        continue;
      }
      const { recipients } = await resolveConfiguredRecipients(l.event_key, c.ctx);
      const r = await sendNotification(l.event_key, {
        to: recipients,
        variables: c.variables,
        relatedEntityType: c.related?.type,
        relatedEntityId: c.related?.id,
        useServiceRole: true,
      });
      // sent > 0 : parti. skipped : désactivé / aucun destinataire (déjà journalisé). Sinon : échec d'envoi → nouvelle tentative.
      if (r.sent > 0 || r.skipped) {
        await db.from("notification_outbox").update({ processed_at: new Date().toISOString(), last_error: null }).eq("id", l.id);
        envoyes += 1;
      } else {
        await db.from("notification_outbox").update({ last_error: "envoi non confirmé (voir l'historique)" }).eq("id", l.id);
        erreurs += 1;
      }
    } catch (e) {
      await db.from("notification_outbox").update({ last_error: e instanceof Error ? e.message.slice(0, 300) : "erreur" }).eq("id", l.id);
      erreurs += 1;
    }
  }
  return { reserves: lignes.length, envoyes, abandonnes, erreurs };
}
