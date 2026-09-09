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
import { FichePatronnageLink } from "./fiche-patronnage-link";
import { AnomaliesPanel } from "./anomalies-panel";
import type { StatutFiche } from "@/lib/patronnage/types";
import { CheckCircle2, Package, QrCode } from "lucide-react";
import Link from "next/link";

const LOT_CATEGORIE_LABELS: Record<string, string> = { semi_fini: "Semi-fini", fini: "Fini", dechet: "Déchet" };

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

  const [
    { data: workOrders },
    { data: allSections },
    { data: chosenSections },
    { data: sizes },
    { data: fiche },
    { data: anomalies },
    { data: articleLots },
    { data: reconciliation },
  ] = await Promise.all([
    supabase.from("work_orders").select("*,sections(name)").eq("production_order_id", id).order("planned_start", { ascending: true }),
    supabase.from("sections").select("id,name").eq("active", true).order("display_order"),
    supabase.from("production_order_sections").select("section_id").eq("production_order_id", id).order("ordre"),
    supabase.from("production_order_sizes").select("taille,quantite_demandee").eq("production_order_id", id),
    supabase.from("fiches_placement").select("id,numero_ot,statut").eq("odf_id", id).maybeSingle(),
    supabase
      .from("production_order_anomalies")
      .select("id,message,created_at,resolved_at,resolved_by,sections(name)")
      .eq("production_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("article_lots")
      .select("id,code,categorie,created_at")
      .eq("production_order_id", id)
      .order("created_at", { ascending: false }),
    // Lot 7 : réconciliation poids entrant / sortant (section 16 du document
    // de logique) — fonction plutôt que vue, voir migration 0017.
    supabase.rpc("get_production_order_reconciliation", { p_production_order_id: id }).single(),
  ]);

  // Lot 2 : la fiche Patronnage liée n'est pertinente que si la section
  // Coupe est retenue (obligatoire pour valider, section 10 du document de
  // logique) — ou si une fiche est déjà liée alors que Coupe a depuis été
  // décochée, pour ne pas faire disparaître un lien existant sans prévenir.
  const coupeSectionId = allSections?.find((s) => s.name === "Coupe")?.id;
  const coupeSelected = !!coupeSectionId && (chosenSections ?? []).some((s) => s.section_id === coupeSectionId);

  // Noms des personnes ayant validé le lancement / demandé ou confirmé la
  // clôture — doivent apparaître à l'écran (et sur le PDF, hors périmètre de
  // cet écran) au même titre qu'archived_at/archived_by (section 4 du
  // document de logique).
  const userIds = [
    order.launched_by,
    order.cloture_demandee_par,
    order.closed_by,
    ...(anomalies ?? []).map((a) => a.resolved_by),
  ].filter((v): v is string => !!v);
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => users?.find((u) => u.id === userId)?.full_name ?? "—";

  const anomalyRows = (anomalies ?? []).map((a) => ({
    id: a.id,
    message: a.message,
    sectionName: (a.sections as unknown as { name: string } | null)?.name ?? null,
    createdAt: a.created_at,
    resolvedAt: a.resolved_at,
    resolvedByName: a.resolved_by ? nameOf(a.resolved_by) : null,
  }));

  const recon = reconciliation as {
    poids_entrant_kg: number;
    poids_sortie_lots_kg: number;
    poids_dechets_kg: number;
    poids_retour_kg: number;
    poids_sortant_total_kg: number;
    ecart_kg: number;
  } | null;
  const hasReconciliationData = !!recon && (recon.poids_entrant_kg > 0 || recon.poids_sortant_total_kg > 0);

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

      <AnomaliesPanel productionOrderId={order.id} anomalies={anomalyRows} canResolve={isAdmin || profile.role === "responsable_production"} />

      {order.mention_surplus_traces && (
        <Card className="border-info/30 bg-info-soft/40">
          <CardBody>
            <p className="text-xs font-medium text-foreground-muted">Surplus tracé vs quantité demandée</p>
            <p className="text-sm text-foreground">
              {Object.entries(order.mention_surplus_traces as Record<string, number>)
                .map(([taille, surplus]) => `${taille} : +${surplus}`)
                .join(" · ")}
            </p>
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

      {(coupeSelected || fiche) && (
        <FichePatronnageLink
          productionOrderId={order.id}
          editable={order.status === "brouillon"}
          fiche={fiche ? { id: fiche.id, numeroOt: fiche.numero_ot, statut: fiche.statut as StatutFiche } : null}
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

      {articleLots && articleLots.length > 0 && (
        <Card>
          <CardHeader title="Lots générés" description="Sérialisation par lot (lot 6) — QR à imprimer par étiquette dédiée." />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {articleLots.map((lot) => (
                <li key={lot.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-3.5 w-3.5 text-foreground-muted" />
                    <span className="font-mono text-xs text-foreground">{lot.code}</span>
                    <Badge tone="brand">{LOT_CATEGORIE_LABELS[lot.categorie] ?? lot.categorie}</Badge>
                  </div>
                  <Link href={`/lots/${lot.code}`} target="_blank" className="text-xs font-medium text-brand hover:underline">
                    Voir le QR →
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {hasReconciliationData && (
        <Card>
          <CardHeader
            title="Réconciliation matière"
            description="Poids entrant (tissu reçu) vs poids sortant (lots + déchets + retours) — lot 7, section 16 du document de logique."
          />
          <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-foreground-muted">Entrant (tissu)</p>
              <p className="font-medium text-foreground">{recon!.poids_entrant_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Sortie lots</p>
              <p className="font-medium text-foreground">{recon!.poids_sortie_lots_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Déchets</p>
              <p className="font-medium text-foreground">{recon!.poids_dechets_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Retour stock</p>
              <p className="font-medium text-foreground">{recon!.poids_retour_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Sortant total</p>
              <p className="font-medium text-foreground">{recon!.poids_sortant_total_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Écart</p>
              <p className={Math.abs(recon!.ecart_kg) > 0.01 ? "font-medium text-warning" : "font-medium text-foreground"}>
                {recon!.ecart_kg} kg
              </p>
            </div>
          </CardBody>
        </Card>
      )}

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
