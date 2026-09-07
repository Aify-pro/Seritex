import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate, formatDateTime } from "@/lib/utils";
import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { ArchiveButton } from "./archive-button";
import { LifecycleActions } from "./lifecycle-actions";
import { SectionsSizesEditor } from "./sections-sizes-editor";
import { CheckCircle2, Package } from "lucide-react";

export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireRole(["responsable_production", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("production_orders")
    .select("*,companies(name),quotes(reference)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const [{ data: workOrders }, { data: allSections }, { data: chosenSections }, { data: sizes }] = await Promise.all([
    supabase.from("work_orders").select("*,sections(name)").eq("production_order_id", id).order("planned_start", { ascending: true }),
    supabase.from("sections").select("id,name").eq("active", true).order("display_order"),
    supabase.from("production_order_sections").select("section_id").eq("production_order_id", id).order("ordre"),
    supabase.from("production_order_sizes").select("taille,quantite_demandee").eq("production_order_id", id),
  ]);

  // Noms des personnes ayant validé le lancement / demandé ou confirmé la
  // clôture — doivent apparaître à l'écran (et sur le PDF, hors périmètre de
  // cet écran) au même titre qu'archived_at/archived_by (section 4 du
  // document de logique).
  const userIds = [order.launched_by, order.cloture_demandee_par, order.closed_by].filter(
    (v): v is string => !!v
  );
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => users?.find((u) => u.id === userId)?.full_name ?? "—";

  const company = order.companies as unknown as { name: string } | null;
  const quote = order.quotes as unknown as { reference: string } | null;
  const canArchive = await can("ordres_fabrication", "archive");
  const canValidate = await can("ordres_fabrication", "validate");
  const canRequestClosure = profile.role === "responsable_production" || profile.role === "administrateur";
  const isAdmin = profile.role === "administrateur";

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

      {order.cloture_note && (
        <Card className="border-warning/30 bg-warning-soft/40">
          <CardBody>
            <p className="text-xs font-medium text-foreground-muted">Note de clôture</p>
            <p className="text-sm text-foreground">{order.cloture_note}</p>
          </CardBody>
        </Card>
      )}

      {order.status === "brouillon" && (
        <SectionsSizesEditor
          productionOrderId={order.id}
          allSections={allSections ?? []}
          initialSectionIds={(chosenSections ?? []).map((s) => s.section_id)}
          initialSizes={sizes ?? []}
        />
      )}

      <LifecycleActions
        productionOrderId={order.id}
        status={order.status}
        canValidate={canValidate}
        canRequestClosure={canRequestClosure}
        isAdmin={isAdmin}
      />

      <Card>
        <CardHeader
          title="Ordres de travail"
          description="Un sous-ODF par section retenue, généré à la validation de l'ODF."
        />
        <CardBody className="p-0">
          {!workOrders || workOrders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">
              Aucun ordre de travail généré pour le moment — les sous-ODF sont créés à la validation de l&apos;ODF.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {workOrders.map((wo, i) => {
                const atteinte = wo.quantity_done >= wo.quantity_planned;
                return (
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
                        {wo.actual_end ? ` · quantité atteinte le ${formatDateTime(wo.actual_end)}` : ""}
                      </p>
                      {wo.blocking_reason && (
                        <p className="mt-1 text-xs text-danger">⚠ {wo.blocking_reason}</p>
                      )}
                    </div>
                    {atteinte ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <Package className="h-4 w-4 shrink-0 text-foreground-muted" />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Historique du cycle de vie" />
        <CardBody className="grid grid-cols-1 gap-3 text-sm text-foreground-muted sm:grid-cols-2">
          <p>Début planifié : {formatDate(order.planned_start_date)}</p>
          <p>Fin planifiée : {formatDate(order.planned_end_date)}</p>
          {order.launched_at && (
            <p>
              Lancé le {formatDateTime(order.launched_at)} par {nameOf(order.launched_by)}
            </p>
          )}
          {order.cloture_demandee_at && (
            <p>
              Clôture demandée le {formatDateTime(order.cloture_demandee_at)} par{" "}
              {nameOf(order.cloture_demandee_par)}
            </p>
          )}
          {order.closed_at && (
            <p>
              Clôturé le {formatDateTime(order.closed_at)} par {nameOf(order.closed_by)}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
