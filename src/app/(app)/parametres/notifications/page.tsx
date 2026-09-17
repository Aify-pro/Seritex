import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import type { NotificationEvent, NotificationLogEntry, NotificationStyleSettings } from "@/lib/types/domain";
import { EventList } from "./event-list";
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

  const [{ data: events }, { data: style }, { data: log }] = await Promise.all([
    supabase.from("notification_events").select("*").order("category").order("label"),
    supabase.from("notification_style_settings").select("*").limit(1).single(),
    supabase.from("notification_log").select("*").order("created_at", { ascending: false }).limit(50),
  ]);

  // Statut de connexion Resend — jamais la clé elle-même, seulement sa
  // présence. La clé reste une variable d'environnement Vercel (jamais en
  // base) : même principe que les identifiants Sage (sage_connection_
  // configs.config, jamais exposés dans un écran de réglage) — un secret
  // technique se configure hors du web, pas dans un formulaire.
  const resendConfigured = !!process.env.RESEND_API_KEY;
  const senderConfigured = !!style?.sender_email;

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
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Événements"
          description="Activez/désactivez chaque événement et éditez son message — un événement correspond à un point déjà câblé dans le code."
        />
        <CardBody>
          <EventList events={(events ?? []) as NotificationEvent[]} />
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
