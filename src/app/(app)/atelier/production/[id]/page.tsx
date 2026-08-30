import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate, formatDateTime } from "@/lib/utils";
import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { LaunchButton } from "./launch-button";
import { ArchiveButton } from "./archive-button";

export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["responsable_production", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("production_orders")
    .select("*,companies(name),quotes(reference)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const { data: workOrders } = await supabase
    .from("work_orders")
    .select("*,sections(name)")
    .eq("production_order_id", id)
    .order("planned_start", { ascending: true });

  const company = order.companies as unknown as { name: string } | null;
  const quote = order.quotes as unknown as { reference: string } | null;
  const canArchive = await can("ordres_fabrication", "archive");

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.reference}
        description={`${company?.name ?? ""} · ${order.total_quantity} pièces · devis ${quote?.reference ?? "—"}`}
        action={
          <div className="flex items-center gap-2">
            {order.archived_at && <Badge tone="neutral">Archivé le {formatDate(order.archived_at)}</Badge>}
            <StatusBadge status={order.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
            {canArchive && <ArchiveButton productionOrderId={order.id} archived={!!order.archived_at} />}
          </div>
        }
      />

      {order.status === "a_lancer" && (
        <Card className="border-brand/30 bg-brand-soft/40">
          <CardBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">Prêt à lancer en fabrication</p>
              <p className="text-xs text-foreground-muted">
                Cela génère automatiquement les ordres de travail pour chaque section de la gamme
                opératoire du produit, dans l&apos;ordre défini.
              </p>
            </div>
            <LaunchButton productionOrderId={order.id} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Ordres de travail"
          description="Un OT par étape de la gamme opératoire, dans l'ordre des sections."
        />
        <CardBody className="p-0">
          {!workOrders || workOrders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">
              Aucun ordre de travail généré pour le moment — lancez l&apos;ordre de fabrication ci-dessus.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {workOrders.map((wo, i) => (
                <li key={wo.id} className="flex items-center gap-4 px-5 py-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground-muted">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {(wo.sections as unknown as { name: string } | null)?.name} — {wo.reference}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {wo.quantity_done}/{wo.quantity_planned} pièces
                      {wo.actual_start ? ` · démarré le ${formatDateTime(wo.actual_start)}` : ""}
                      {wo.actual_end ? ` · terminé le ${formatDateTime(wo.actual_end)}` : ""}
                    </p>
                    {wo.blocking_reason && (
                      <p className="mt-1 text-xs text-danger">⚠ {wo.blocking_reason}</p>
                    )}
                  </div>
                  <StatusBadge status={wo.status} labels={WORK_ORDER_STATUS_LABELS} kind="work_order" />
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm text-foreground-muted">
        <p>Début planifié : {formatDate(order.planned_start_date)}</p>
        <p>Fin planifiée : {formatDate(order.planned_end_date)}</p>
      </div>
    </div>
  );
}
