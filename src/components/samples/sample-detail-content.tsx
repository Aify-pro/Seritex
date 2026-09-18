import Link from "next/link";
import { Printer, ExternalLink, Link2, Unlink } from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import {
  SAMPLE_STATUS_LABELS,
  SAMPLE_PRIORITY_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  type SampleRequestStatus,
  type SamplePriority,
} from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { SampleQrCode } from "@/components/samples/sample-qr-code";
import { SampleStatusSelect } from "@/components/samples/sample-status-select";
import { SampleProductionOrderLink, type ProductionOrderLineOption } from "@/components/samples/sample-production-order-link";
import { SampleMediaFiles, type AttachableMediaFile } from "@/components/samples/sample-media-files";
import { SampleEditDialog } from "@/components/samples/sample-edit-dialog";
import { SampleDecisionForm } from "@/components/samples/sample-decision-form";
import { DeleteSampleButton } from "@/components/samples/delete-sample-button";
import { SampleRequestLink } from "@/components/samples/sample-request-link";
import { SampleQuoteLineLink } from "@/components/samples/sample-quote-line-link";
import type { SampleRequestOption, SampleQuoteLineOption } from "@/lib/samples";

export interface SampleDetailData {
  id: string;
  reference: string;
  sample_number: string;
  need_description: string;
  status: SampleRequestStatus;
  priority: SamplePriority;
  request_date: string;
  due_date: string | null;
  extra_info: string | null;
  company_id: string;
  request_id: string | null;
  quote_line_id: string | null;
  production_order_line_id: string | null;
  companyName?: string;
}

/**
 * Rattachements de la fiche (migration 0051) : sa demande, les lignes des
 * devis de cette demande, et — seulement si elle n'est pas encore
 * rattachée — les demandes de son entreprise.
 */
export interface SampleLinksData {
  request: { id: string; reference: string } | null;
  quoteLines: SampleQuoteLineOption[];
  attachableRequests: SampleRequestOption[];
}

/**
 * Contenu complet d'une fiche échantillon — la "prévisualisation" demandée :
 * tout ce qui était affiché en permanence dans la liste (QR code compris)
 * vit maintenant ici, réutilisé à la fois dans la fenêtre interne ouverte
 * depuis la liste et sur la page autonome `/echantillons/[sample_number]`
 * (cible du QR code imprimé, accessible depuis un mobile).
 */
export function SampleDetailContent({
  sample,
  links,
  baseUrl,
  companyProductionOrderLines,
  attachedMedia,
  availableMedia,
  permissions,
}: {
  sample: SampleDetailData;
  links: SampleLinksData;
  baseUrl: string;
  companyProductionOrderLines: ProductionOrderLineOption[];
  attachedMedia: AttachableMediaFile[];
  availableMedia: AttachableMediaFile[];
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canManageStatus: boolean;
    canLinkProductionOrder: boolean;
    /** Demande et ligne de devis : commercial / administrateur uniquement. */
    canLinkRequestAndQuoteLine: boolean;
    canDecide: boolean;
  };
}) {
  const fullUrl = `${baseUrl}/echantillons/${sample.sample_number}`;
  const pdfUrl = `${baseUrl}/api/echantillons/${sample.id}/pdf`;
  const linkedLine = companyProductionOrderLines.find((l) => l.id === sample.production_order_line_id);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {sample.reference}
              {sample.companyName ? ` · ${sample.companyName}` : ""}
            </p>
            <StatusBadge status={sample.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
            <PriorityBadge priority={sample.priority} label={SAMPLE_PRIORITY_LABELS[sample.priority]} />
          </div>
          <p className="font-mono text-xs text-foreground-muted">{sample.sample_number}</p>
        </div>
        {permissions.canManageStatus && <SampleStatusSelect sampleId={sample.id} current={sample.status} />}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-foreground-muted">Besoin exprimé</p>
            <p className="text-sm text-foreground">{sample.need_description}</p>
          </div>
          {sample.extra_info && (
            <div>
              <p className="text-xs font-medium text-foreground-muted">Informations complémentaires</p>
              <p className="text-sm italic text-foreground">{sample.extra_info}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-foreground-muted">Date de la demande</p>
              <p className="text-sm text-foreground">{formatDate(sample.request_date)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground-muted">Délai souhaité</p>
              <p className="text-sm text-foreground">{formatDate(sample.due_date)}</p>
            </div>
          </div>

          <SampleRequestLink
            sampleId={sample.id}
            request={links.request}
            attachableRequests={links.attachableRequests}
            canAttach={permissions.canLinkRequestAndQuoteLine}
            linkToRequest={permissions.canLinkRequestAndQuoteLine}
          />

          {links.request && (
            <SampleQuoteLineLink
              sampleId={sample.id}
              currentQuoteLineId={sample.quote_line_id}
              quoteLines={links.quoteLines}
              canEdit={permissions.canLinkRequestAndQuoteLine}
            />
          )}

          {/* Lié à une ligne de devis : l'article d'ODF en découle (0051),
              plus de choix libre ici. */}
          {permissions.canLinkProductionOrder && !sample.quote_line_id ? (
            <SampleProductionOrderLink
              sampleId={sample.id}
              currentProductionOrderLineId={sample.production_order_line_id}
              companyProductionOrderLines={companyProductionOrderLines}
            />
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
              {sample.production_order_line_id ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
              Article d&apos;ordre de fabrication :{" "}
              {linkedLine
                ? `${linkedLine.orderReference} — ${linkedLine.description} · ${PRODUCTION_ORDER_STATUS_LABELS[linkedLine.status]}`
                : sample.quote_line_id
                  ? "rattaché automatiquement quand le devis passera en ODF"
                  : "aucun"}
            </div>
          )}

          <SampleMediaFiles sampleId={sample.id} attached={attachedMedia} available={availableMedia} />

          {permissions.canDecide && (sample.status === "envoye" || sample.status === "recu_client") && (
            <SampleDecisionForm sampleId={sample.id} />
          )}
        </div>

        <div className="flex flex-col items-center gap-3 sm:border-l sm:border-border sm:pl-5">
          <SampleQrCode url={fullUrl} label={sample.sample_number} size={112} />
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
          >
            <Printer className="h-3.5 w-3.5" /> Imprimer (PDF)
          </a>
          <Link
            href={`/echantillons/${sample.sample_number}`}
            target="_blank"
            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Ouvrir la fiche complète
          </Link>
        </div>
      </div>

      {(permissions.canEdit || permissions.canDelete) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {permissions.canEdit && (
            <SampleEditDialog
              sampleId={sample.id}
              needDescription={sample.need_description}
              priority={sample.priority}
              requestDate={sample.request_date}
              dueDate={sample.due_date}
              extraInfo={sample.extra_info}
            />
          )}
          {permissions.canDelete && sample.production_order_line_id === null && (
            <DeleteSampleButton sampleId={sample.id} />
          )}
          {permissions.canDelete && sample.production_order_line_id !== null && (
            <p className="text-xs text-foreground-muted">
              Suppression indisponible : cette fiche est attribuée à un article d&apos;ordre de fabrication.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
