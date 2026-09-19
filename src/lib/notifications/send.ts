import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResendClient } from "./client";
import { renderTemplate } from "./template";
import { wrapHtml } from "./wrapper";
import type { NotificationLogStatus, NotificationRecipient } from "@/lib/types/domain";

export type SendNotificationInput = {
  /** Toujours appelée, même vide — sendNotification décide seule quoi journaliser, jamais l'appelant. */
  to: NotificationRecipient[];
  variables?: Record<string, string | number | null | undefined>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Marque les lignes de log issues du bouton "Envoyer un test" (Paramètres > Notifications). */
  isTest?: boolean;
  /** Réservé à sendTestNotification() : envoie même si l'événement est désactivé. */
  bypassEnabledCheck?: boolean;
  /**
   * Lit la configuration et écrit le journal avec le client service_role
   * plutôt qu'avec la session de l'appelant. Réservé aux envois sans session :
   * « mot de passe oublié » est déclenché par quelqu'un qui n'est pas connecté,
   * donc soumis à la RLS `authenticated` de notification_events/log. L'appelant
   * reste responsable de n'utiliser cette option que sur un chemin déjà
   * contrôlé (destinataire résolu côté serveur, jamais saisi tel quel).
   */
  useServiceRole?: boolean;
};

export type SendNotificationResult = {
  attempted: number;
  sent: number;
  /** true si aucun envoi n'a été tenté (événement introuvable/désactivé, ou aucun destinataire). */
  skipped: boolean;
};

type LogRow = {
  event_key: string;
  recipient_email: string;
  recipient_label: string | null;
  subject: string;
  status: NotificationLogStatus;
  is_test: boolean;
  provider_message_id: string | null;
  error_message: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  triggered_by: string | null;
};

/**
 * Point d'entrée UNIQUE pour déclencher un envoi. Ne lève JAMAIS d'exception
 * — un échec d'email ne doit jamais casser l'action métier qui l'a
 * déclenché. Journalise systématiquement ce qu'il s'est passé (envoyé,
 * simulé, désactivé, aucun destinataire, échec) dans notification_log.
 */
export async function sendNotification(eventKey: string, input: SendNotificationInput): Promise<SendNotificationResult> {
  try {
    const supabase = input.useServiceRole ? createAdminClient() : await createClient();
    const triggeredBy = input.useServiceRole ? null : ((await supabase.auth.getUser()).data.user?.id ?? null);

    const [{ data: event }, { data: style }] = await Promise.all([
      supabase.from("notification_events").select("*").eq("event_key", eventKey).maybeSingle(),
      supabase.from("notification_style_settings").select("*").limit(1).maybeSingle(),
    ]);

    const baseLog = {
      event_key: eventKey,
      is_test: input.isTest ?? false,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
      triggered_by: triggeredBy,
    };

    if (!event) {
      await insertLogRows(
        supabase,
        input.to.map((r) => ({
          ...baseLog,
          recipient_email: r.email,
          recipient_label: r.label ?? null,
          subject: "",
          status: "echec" as const,
          provider_message_id: null,
          error_message: "Événement introuvable — code non aligné avec le seed notification_events.",
        }))
      );
      return { attempted: input.to.length, sent: 0, skipped: true };
    }

    if (!event.enabled && !input.bypassEnabledCheck) {
      await insertLogRows(
        supabase,
        input.to.map((r) => ({
          ...baseLog,
          recipient_email: r.email,
          recipient_label: r.label ?? null,
          subject: event.subject_template,
          status: "desactive" as const,
          provider_message_id: null,
          error_message: null,
        }))
      );
      return { attempted: input.to.length, sent: 0, skipped: true };
    }

    if (input.to.length === 0) {
      await insertLogRows(supabase, [
        {
          ...baseLog,
          recipient_email: "(aucun destinataire résolu)",
          recipient_label: null,
          subject: event.subject_template,
          status: "ignore_pas_de_destinataire",
          provider_message_id: null,
          error_message: null,
        },
      ]);
      return { attempted: 0, sent: 0, skipped: true };
    }

    const mergedVariables = { ...input.variables, lien_base: style?.app_base_url ?? "" };
    const resend = getResendClient();
    const rows: LogRow[] = [];

    for (const recipient of input.to) {
      const subject = renderTemplate(event.subject_template, mergedVariables);
      const html = wrapHtml(renderTemplate(event.body_template, mergedVariables), {
        sender_name: style?.sender_name ?? "Seritex",
        brand_color: style?.brand_color ?? "#0f172a",
        logo_url: style?.logo_url ?? null,
        footer_text: style?.footer_text ?? null,
      });

      if (!resend) {
        console.log(`[notifications] SIMULATION — aurait envoyé "${subject}" à ${recipient.email} (RESEND_API_KEY absent)`);
        rows.push({
          ...baseLog,
          recipient_email: recipient.email,
          recipient_label: recipient.label ?? null,
          subject,
          status: "simule",
          provider_message_id: null,
          error_message: null,
        });
        continue;
      }

      if (!style?.sender_email) {
        rows.push({
          ...baseLog,
          recipient_email: recipient.email,
          recipient_label: recipient.label ?? null,
          subject,
          status: "echec",
          provider_message_id: null,
          error_message: "Aucune adresse expéditeur configurée (Paramètres > Notifications).",
        });
        continue;
      }

      try {
        const { data, error } = await resend.emails.send({
          from: `${style.sender_name} <${style.sender_email}>`,
          to: recipient.email,
          subject,
          html,
        });
        if (error) {
          rows.push({
            ...baseLog,
            recipient_email: recipient.email,
            recipient_label: recipient.label ?? null,
            subject,
            status: "echec",
            provider_message_id: null,
            error_message: error.message,
          });
        } else {
          rows.push({
            ...baseLog,
            recipient_email: recipient.email,
            recipient_label: recipient.label ?? null,
            subject,
            status: "envoye",
            provider_message_id: data?.id ?? null,
            error_message: null,
          });
        }
      } catch (err) {
        rows.push({
          ...baseLog,
          recipient_email: recipient.email,
          recipient_label: recipient.label ?? null,
          subject,
          status: "echec",
          provider_message_id: null,
          error_message: err instanceof Error ? err.message : "Erreur inconnue lors de l'envoi.",
        });
      }
    }

    await insertLogRows(supabase, rows);
    const sent = rows.filter((r) => r.status === "envoye" || r.status === "simule").length;
    return { attempted: input.to.length, sent, skipped: false };
  } catch (err) {
    console.error("[notifications] sendNotification a échoué de façon inattendue :", err);
    return { attempted: input.to.length, sent: 0, skipped: true };
  }
}

async function insertLogRows(supabase: SupabaseClient, rows: LogRow[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("notification_log").insert(rows);
  if (error) console.error("[notifications] Échec de l'écriture dans notification_log :", error.message);
}
