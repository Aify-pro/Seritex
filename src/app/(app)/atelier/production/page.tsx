import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody, StatCard } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr, StopRowClick } from "@/components/ui/clickable-row";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { RealtimeRefresher } from "@/components/shell/realtime-refresher";
import Link from "next/link";
import { Eye, Printer, TriangleAlert } from "lucide-react";

export default async function ProductionOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ archives?: string }>;
}) {
  await requireRole(["responsable_production", "administrateur"]);
  const { archives } = await searchParams;
  const showArchived = archives === "1";
  const supabase = await createClient();
  const baseUrl = await getBaseUrl();

  let query = supabase
    .from("production_orders")
    .select("id,reference,status,total_quantity,planned_start_date,planned_end_date,archived_at,companies(name)")
    .order("created_at", { ascending: false });
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  const [{ data: orders }, { data: sections }, { data: workOrders }, { data: openAnomalies }] = await Promise.all([
    query,
    supabase.from("sections").select("id,name").eq("active", true).order("display_order"),
    supabase.from("work_orders").select("id,section_id,quantity_planned,quantity_done"),
    // Lot 5 : flag calculé, pas un statut — un triangle par ODF ayant au
    // moins une anomalie non résolue (section 14 du document de logique).
    supabase.from("production_order_anomalies").select("production_order_id").is("resolved_at", null),
  ]);
  const odfWithOpenAnomaly = new Set((openAnomalies ?? []).map((a) => a.production_order_id));

  const today = new Date().toISOString().slice(0, 10);
  const enCoursOrders = orders?.filter((o) => o.status === "en_production").length ?? 0;
  const enAttenteValidationOrders = orders?.filter((o) => o.status === "en_attente_validation").length ?? 0;
  const enRetardOrders =
    orders?.filter(
      (o) =>
        o.planned_end_date !== null &&
        o.planned_end_date < today &&
        !["terminee", "annulee", "refuse"].includes(o.status)
    ).length ?? 0;

  return (
    <div className="space-y-6">
      <RealtimeRefresher table="work_orders" />
      <RealtimeRefresher table="production_orders" />

      <PageHeader
        title="Ordres de fabrication"
        description="Un devis accepté génère un ordre de fabrication à composer, soumettre puis valider."
        action={
          <Link
            href={showArchived ? "/atelier/production" : "/atelier/production?archives=1"}
            className="text-xs font-medium text-brand hover:underline"
          >
            {showArchived ? "← Voir les ODF actifs" : "Voir les ODF archivés"}
          </Link>
        }
      />

      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Avancement en temps réel
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Ordres de fabrication en cours" value={enCoursOrders} tone="brand" />
          <StatCard label="Ordres de fabrication en attente de validation" value={enAttenteValidationOrders} tone="warning" />
          <StatCard label="Ordres de fabrication en retard" value={enRetardOrders} tone="danger" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {sections?.map((section) => {
            const sectionOrders = workOrders?.filter((w) => w.section_id === section.id) ?? [];
            const enCours = sectionOrders.filter((w) => w.quantity_done < w.quantity_planned);
            const atteintes = sectionOrders.filter((w) => w.quantity_done >= w.quantity_planned);

            return (
              <Link
                key={section.id}
                href={`/atelier/section?section=${section.id}`}
                className="block rounded-lg"
              >
                <Card className="cursor-pointer transition-colors hover:bg-surface-muted/40">
                  <CardHeader title={section.name} />
                  <CardBody>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-md bg-surface-muted px-2 py-2">
                        <p className="text-lg font-semibold text-foreground">{enCours.length}</p>
                        <p className="text-[10px] text-foreground-muted">En cours</p>
                      </div>
                      <div className="rounded-md bg-surface-muted px-2 py-2">
                        <p className="text-lg font-semibold text-foreground">{atteintes.length}</p>
                        <p className="text-[10px] text-foreground-muted">Quantité atteinte</p>
                      </div>
                    </div>
                    {sectionOrders.length === 0 && (
                      <p className="mt-3 text-center text-xs text-foreground-muted">Aucun ordre de travail.</p>
                    )}
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Référence</Th>
                <Th>Client</Th>
                <Th align="center">Quantité</Th>
                <Th>Statut</Th>
                <Th>Fin planifiée</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {orders?.map((o) => (
                <ClickableTr key={o.id} href={`/atelier/production/${o.id}`}>
                  <Td>
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      {o.reference}
                      {odfWithOpenAnomaly.has(o.id) && (
                        <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-label="Anomalie signalée" />
                      )}
                    </p>
                    {o.archived_at && (
                      <Badge tone="neutral" className="mt-1">
                        Archivé
                      </Badge>
                    )}
                  </Td>
                  <Td>{(o.companies as unknown as { name: string } | null)?.name ?? "—"}</Td>
                  <Td align="center">{o.total_quantity} pièces</Td>
                  <Td>
                    <StatusBadge status={o.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
                  </Td>
                  <Td>{formatDate(o.planned_end_date)}</Td>
                  <Td align="right">
                    <StopRowClick className="flex items-center justify-end gap-1.5">
                      <Link href={`/atelier/production/${o.id}`}>
                        <Button variant="secondary" size="sm">
                          <Eye className="h-3.5 w-3.5" /> Voir
                        </Button>
                      </Link>
                      <a
                        href={`${baseUrl}/api/production/${o.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
                      >
                        <Printer className="h-3.5 w-3.5" /> PDF
                      </a>
                    </StopRowClick>
                  </Td>
                </ClickableTr>
              ))}
              {(!orders || orders.length === 0) && (
                <EmptyRow colSpan={6}>
                  {showArchived ? "Aucun ordre de fabrication archivé." : "Aucun ordre de fabrication pour le moment."}
                </EmptyRow>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
