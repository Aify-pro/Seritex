import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications/send";
import type { NotificationRecipient } from "@/lib/types/domain";

/**
 * E-mails du circuit de livraison (LIV-2, L8, Q-LIV-4). Destinataires : le
 * contact de la demande d'origine, à défaut le contact principal du client,
 * plus les contacts qui ont un compte portail. Résolus avec le client
 * d'administration : le livreur, qui déclenche « en route » et « livrée »,
 * n'a pas accès aux contacts (RLS), et la page publique de confirmation n'a
 * pas de session. Un échec d'envoi ne bloque jamais le geste métier.
 */
export async function resolveShipmentRecipients(shipmentId: string): Promise<NotificationRecipient[]> {
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("shipments")
    .select("company_id,production_orders(quotes(requests(contact_id)))")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!s) return [];
  const out = new Map<string, NotificationRecipient>();
  const add = (email: string | null | undefined, label: string) => {
    if (email && !out.has(email.toLowerCase())) out.set(email.toLowerCase(), { email, label });
  };

  const contactId = (s.production_orders as unknown as { quotes: { requests: { contact_id: string | null } | null } | null } | null)?.quotes
    ?.requests?.contact_id;
  if (contactId) {
    const { data: c } = await admin.from("contacts").select("email,first_name,last_name").eq("id", contactId).maybeSingle();
    add(c?.email, `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim());
  }
  if (out.size === 0) {
    const { data: contacts } = await admin
      .from("contacts")
      .select("email,first_name,last_name,is_primary_contact")
      .eq("company_id", s.company_id)
      .not("email", "is", null)
      .order("is_primary_contact", { ascending: false })
      .limit(1);
    const c = contacts?.[0];
    add(c?.email, `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim());
  }
  const { data: portal } = await admin
    .from("app_users")
    .select("email,full_name")
    .eq("company_id", s.company_id)
    .eq("role", "client")
    .eq("active", true);
  for (const u of portal ?? []) add(u.email, u.full_name);
  return [...out.values()];
}

/** Service livraison (litige interne). */
async function resolveDeliveryTeam(): Promise<NotificationRecipient[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("app_users").select("email,full_name").eq("role", "responsable_livraison").eq("active", true);
  return (data ?? []).map((u) => ({ email: u.email, label: u.full_name }));
}

async function shipmentVariables(shipmentId: string) {
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("shipments")
    .select("reference,client_nom,lieu_libelle,date_promise,date_planifiee,livree_at,livreur_id,production_orders(reference),shipment_lines(quantite,quantite_livree)")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!s) return null;
  const { data: livreur } = s.livreur_id ? await admin.from("app_users").select("full_name,phone").eq("id", s.livreur_id).maybeSingle() : { data: null };
  const fmt = (d: string | null) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(d)) : "à confirmer");
  return {
    numero_bl: s.reference ?? "",
    numero_odf: (s.production_orders as unknown as { reference: string } | null)?.reference ?? "",
    nom_client: s.client_nom ?? "",
    pieces: ((s.shipment_lines ?? []) as { quantite: number; quantite_livree: number | null }[]).reduce((t, l) => t + (l.quantite_livree ?? l.quantite), 0),
    date_prevue: fmt(s.date_planifiee ?? s.date_promise),
    date_livraison: fmt(s.livree_at),
    lieu: s.lieu_libelle ?? "",
    livreur: [livreur?.full_name, livreur?.phone].filter(Boolean).join(" — "),
  };
}

export type ShipmentEvent =
  | "livraison_preparee"
  | "livraison_en_route"
  | "livraison_livree_confirmer"
  | "livraison_prete_a_enlever"
  | "livraison_litige";

/**
 * Envoie l'e-mail d'une étape. `extra` complète les variables (lien de
 * confirmation, commentaire du litige). `withoutSession` : page publique.
 */
export async function notifyShipment(
  event: ShipmentEvent,
  shipmentId: string,
  extra: Record<string, string> = {},
  opts: { withoutSession?: boolean } = {}
) {
  try {
    const variables = await shipmentVariables(shipmentId);
    if (!variables) return;
    const to = event === "livraison_litige" ? await resolveDeliveryTeam() : await resolveShipmentRecipients(shipmentId);
    await sendNotification(event, {
      to,
      variables: { ...variables, ...extra },
      relatedEntityType: "shipment",
      relatedEntityId: shipmentId,
      useServiceRole: opts.withoutSession,
    });
  } catch (e) {
    console.error("Notification de livraison non envoyée :", e);
  }
}
