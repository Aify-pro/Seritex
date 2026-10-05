import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { getSizes } from "@/lib/sizes";
import { CreateStockOdfButton } from "./create-stock-odf-button";

interface StockRequestView {
  id: string;
  reference: string;
  status: string;
  description: string | null;
  created_at: string;
  lignes: { description: string; tailles: Record<string, number> }[];
  odf: { id: string; reference: string } | null;
}

/**
 * Fiche d'une demande pour le stock (SF-3) : motif, articles et quantités,
 * puis l'ODF de stock qui en est tiré (production ou Direction).
 */
export async function StockRequestDetail({ request, canCreateOdf }: { request: StockRequestView; canCreateOdf: boolean }) {
  const sizes = await getSizes();
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;
  return (
    <div className="space-y-6">
      <PageHeader
        title={request.reference}
        description={`Demande pour le stock · ${formatDate(request.created_at)}`}
        action={<StatusBadge status={request.status} labels={REQUEST_STATUS_LABELS} kind="request" />}
      />
      {request.description && (
        <Card>
          <CardBody className="text-sm">{request.description}</CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Articles demandés" />
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {request.lignes.map((l, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium">{l.description}</span>
                <span className="text-xs tabular-nums text-foreground-muted">
                  {Object.entries(l.tailles)
                    .map(([t, q]) => `${libelle(t)} ${q}`)
                    .join(" · ")}{" "}
                  — {Object.values(l.tailles).reduce((a, b) => a + b, 0)} pièce(s)
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Ordre de fabrication de stock" description="Il passe sans attestation comptable, ne crée aucune livraison, et son 1er choix entre en stock." />
        <CardBody>
          {request.odf ? (
            <Link href={`/atelier/production/${request.odf.id}`} className="text-sm font-medium text-brand hover:underline">
              {request.odf.reference} →
            </Link>
          ) : canCreateOdf ? (
            <CreateStockOdfButton requestId={request.id} />
          ) : (
            <p className="text-sm text-foreground-muted">En attente de la production.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
