import { Globe, Mail, Phone, Building2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { LinkSiteRequestForm } from "./link-site-request-form";

export interface SiteProspect {
  nom: string;
  entreprise?: string | null;
  email: string;
  telephone?: string | null;
}

interface SiteRequestView {
  id: string;
  reference: string;
  status: string;
  description: string | null;
  created_at: string;
  prospect: SiteProspect;
}

/**
 * Demande reçue du site web pour un client encore inconnu (migration 0098).
 * Étapes : créer le client dans Sage, attendre la synchronisation, rattacher
 * ici la demande à la fiche — elle devient alors une demande client normale.
 */
export function SiteRequestDetail({ request, canLink }: { request: SiteRequestView; canLink: boolean }) {
  const p = request.prospect;
  return (
    <div className="space-y-6">
      <PageHeader
        title={request.reference}
        description={`Demande du site web · ${formatDate(request.created_at)}`}
        action={<StatusBadge status={request.status} labels={REQUEST_STATUS_LABELS} kind="request" />}
      />

      <Card>
        <CardHeader title="Prospect" description="Client pas encore reconnu dans Seritex (aucun contact ni fiche avec cet e-mail)." />
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
          <p className="flex items-center gap-2 font-medium">
            <Globe className="h-4 w-4 text-foreground-muted" /> {p.nom}
          </p>
          {p.entreprise && (
            <p className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-foreground-muted" /> {p.entreprise}
            </p>
          )}
          <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-brand hover:underline">
            <Mail className="h-4 w-4" /> {p.email}
          </a>
          {p.telephone && (
            <a href={`tel:${p.telephone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-brand hover:underline">
              <Phone className="h-4 w-4" /> {p.telephone}
            </a>
          )}
        </CardBody>
      </Card>

      {request.description && (
        <Card>
          <CardHeader title="Projet" />
          <CardBody className="whitespace-pre-line text-sm">{request.description}</CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Rattacher au client"
          description="1. Créez le client dans Sage. 2. Attendez la synchronisation (il apparaît dans Clients). 3. Choisissez-le ici : le prospect devient un contact du client et vous pouvez faire le devis."
        />
        <CardBody>
          {canLink ? (
            <LinkSiteRequestForm requestId={request.id} suggestion={p.entreprise ?? p.nom} />
          ) : (
            <p className="text-sm text-foreground-muted">Réservé aux commerciaux et à la Direction.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
