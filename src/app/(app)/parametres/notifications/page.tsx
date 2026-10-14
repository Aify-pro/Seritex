import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import type { NotificationEvent, NotificationLogEntry, NotificationStyleSettings } from "@/lib/types/domain";
import { EventList } from "./event-list";
import type { RecipientView, RoleChoice, UserChoice } from "./event-recipients";
import { StyleSettingsForm } from "./style-settings-form";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  envoye: "Envoyé",
  simule: "Simulé",
  echec: "Échec",
  desactive: "Désactivé",
  ignore_pas_de_destinataire: "Aucun destinataire",
};

const STATUS_TONE: Record<string, "success" | "info" | "danger" | "neutral" | "warning"> = {
  envoye: "success",
  simule: "info",
  echec: "danger",
  desactive: "neutral",
  ignore_pas_de_destinataire: "warning",
};

/**
 * Paramètres > Notifications (migration 0046) — configure les événements
 * qui déclenchent un email (Resend), leur message, l'image de marque
 * commune, et l'historique d'envoi. N'ajoute PAS de nouveaux points de
 * déclenchement : chaque ligne d'événement correspond à un appel
 * sendNotification() déjà câblé dans le code — en ajouter un nouveau reste
 * un (petit) chantier de code, pas une action depuis cet écran.
 */
export default async function NotificationsSettingsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const admin = createAdminClient();
  const [{ data: events }, { data: style }, { data: log }, { data: recipients }, { data: users }, { data: roles }, enAttente, bloques] = await Promise.all([
    supabase.from("notification_events").select("*").order("category").order("label"),
    supabase.from("notification_style_settings").select("*").limit(1).single(),
    supabase.from("notification_log").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("notification_recipients").select("id, event_key, kind, user_id, role_key"),
    // Le personnel seulement (jamais un compte client), actif.
    supabase.from("app_users").select("id, full_name, email").eq("active", true).neq("role", "client").order("full_name"),
    supabase.from("roles").select("key, label").eq("active", true).neq("key", "client").order("label"),
    // File des événements déclenchés par la base (service_role seul : la table est fermée aux comptes connectés).
    admin.from("notification_outbox").select("id", { count: "exact", head: true }).is("processed_at", null).lt("attempts", 6),
    admin.from("notification_outbox").select("id", { count: "exact", head: true }).is("processed_at", null).gte("attempts", 6),
  ]);

  // Statut de connexion Resend — jamais la clé elle-même, seulement sa
  // présence. La clé reste une variable d'environnement Vercel (jamais en
  // base) : même principe que les identifiants Sage (sage_connection_
  // configs.config, jamais exposés dans un écran de réglage) — un secret
  // technique se configure hors du web, pas dans un formulaire.
  const resendConfigured = !!process.env.RESEND_API_KEY;
  const senderConfigured = !!style?.sender_email;
  const cronConfigured = !!process.env.CRON_SECRET;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Événements déclenchant un email, message de chacun, image de marque commune et historique d'envoi (Resend)."
      />

      <Card>
        <CardHeader title="Connexion Resend" description="La clé API se configure côté Vercel, jamais dans cet écran — c'est un secret technique." />
        <CardBody className="space-y-3">
          <div
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
              resendConfigured ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            }`}
          >
            {resendConfigured ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>
              <p className="font-medium">
                {resendConfigured ? "Clé API Resend détectée" : "Clé API Resend non configurée"}
              </p>
              {!resendConfigured && (
                <p className="mt-0.5 text-xs">
                  Tant qu&apos;elle n&apos;est pas posée, tous les envois sont simulés (journalisés dans l&apos;historique
                  ci-dessous, jamais réellement envoyés). Ajoutez <code>RESEND_API_KEY</code> dans les variables
                  d&apos;environnement Vercel (Production et Preview), puis redéployez.
                </p>
              )}
            </div>
          </div>
          <div
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
              senderConfigured ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            }`}
          >
            {senderConfigured ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p>
              {senderConfigured
                ? `Adresse expéditeur : ${style?.sender_email}`
                : "Aucune adresse expéditeur — à renseigner ci-dessous (« Image de marque »), sur le domaine vérifié dans Resend."}
            </p>
          </div>
          <div
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
              cronConfigured && !bloques.count ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            }`}
          >
            {cronConfigured && !bloques.count ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p>
              {!cronConfigured
                ? "Envoi automatique des événements du site (devis accepté, message client) inactif : ajoutez CRON_SECRET dans les variables d'environnement Vercel (Production), puis redéployez."
                : bloques.count
                  ? `${bloques.count} événement(s) abandonné(s) après 6 tentatives — voir l'historique (échecs).`
                  : `Envoi automatique actif (toutes les minutes). ${enAttente.count ?? 0} événement(s) en attente.`}
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Événements"
          description="Activez/désactivez chaque événement, éditez son message et choisissez qui le reçoit — un événement correspond à un point déjà câblé (code ou base)."
        />
        <CardBody>
          <EventList
            events={(events ?? []) as NotificationEvent[]}
            recipients={(recipients ?? []) as (RecipientView & { event_key: string })[]}
            users={(users ?? []) as UserChoice[]}
            roles={(roles ?? []) as RoleChoice[]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Image de marque" description="Commune à tous les emails de notification." />
        <CardBody>{style && <StyleSettingsForm style={style as NotificationStyleSettings} />}</CardBody>
      </Card>

      <Card>
        <CardHeader title="Historique récent" description="Les 50 derniers envois tentés, tous événements confondus." />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Événement</Th>
                <Th>Destinataire</Th>
                <Th>Sujet</Th>
                <Th>Statut</Th>
                <Th>Date</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(log as NotificationLogEntry[] | null)?.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="font-mono text-xs">
                    {entry.event_key}
                    {entry.is_test && <span className="ml-1.5 text-warning">(test)</span>}
                  </Td>
                  <Td>{entry.recipient_label ? `${entry.recipient_label} · ${entry.recipient_email}` : entry.recipient_email}</Td>
                  <Td className="max-w-xs truncate">{entry.subject}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[entry.status] ?? "neutral"}>{STATUS_LABELS[entry.status] ?? entry.status}</Badge>
                    {entry.error_message && <p className="mt-1 text-xs text-danger">{entry.error_message}</p>}
                  </Td>
                  <Td className="text-xs text-foreground-muted">{formatDateTime(entry.created_at)}</Td>
                </Tr>
              ))}
              {(!log || log.length === 0) && <EmptyRow colSpan={5}>Aucun envoi pour le moment.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
