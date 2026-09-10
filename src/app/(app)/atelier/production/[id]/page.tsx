import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS, type MediaFileCategory } from "@/lib/types/domain";
import { formatDate, formatDateTime } from "@/lib/utils";
import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { ArchiveButton } from "./archive-button";
import { LifecycleActions } from "./lifecycle-actions";
import { SectionsSizesEditor } from "./sections-sizes-editor";
import { FichePatronnageLink } from "./fiche-patronnage-link";
import { AnomaliesPanel } from "./anomalies-panel";
import { ProductConfigurator } from "./product-configurator";
import { ProductionOrderMediaFiles } from "./production-order-media-files";
import { StockMovementsPanel } from "./stock-movements-panel";
import { StockEntryForm } from "./stock-entry-form";
import type { StatutFiche } from "@/lib/patronnage/types";
import type { StockMovement, StockExportFiche } from "@/lib/types/domain";
import { CheckCircle2, ChevronRight, Package, QrCode } from "lucide-react";
import Link from "next/link";

const LOT_CATEGORIE_LABELS: Record<string, string> = { semi_fini: "Semi-fini", fini: "Fini", dechet: "Déchet" };

export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireRole(["responsable_production", "administrateur", "gestionnaire_stock"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("production_orders")
    .select("*,companies(name),quotes(reference),product_models(id,name)")
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
    { data: rendement },
    { data: rendementTraces },
    { data: productModels },
    { data: activeColors },
    { data: zoneTemplate },
    { data: zoneColors },
    { data: attachedMedia },
    { data: availableMedia },
    { data: stockMovements },
    { data: stockExportFiches },
    { data: stockItems },
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
    // Lot 8 : rendement matière — vue calculée à partir des lots 4 et 7,
    // voir migration 0018. maybeSingle() : la vue n'a une ligne pour cet ODF
    // que si au moins un matelas y a déjà été clôturé.
    supabase.from("rendement_par_odf").select("*").eq("odf_id", id).maybeSingle(),
    // Détail par matelas, pour le lien direct vers chaque tracé dans le
    // module Patronnage (voir carte "Rendement matière" plus bas).
    supabase
      .from("rendement_par_trace")
      .select("trace_id,fiche_id,reference,cloture_le,pieces_obtenues,rendement_estime_pieces_par_kg")
      .eq("odf_id", id)
      .order("cloture_le", { ascending: false }),
    // Lot 9 : configurateur couleur par zone (section 8/9 du document de logique).
    supabase.from("product_models").select("id,name").eq("active", true).order("name"),
    supabase.from("colors").select("id,name,code").eq("active", true).order("name"),
    // .eq() sur une colonne uuid avec une chaîne vide lèverait une erreur
    // Postgres ("invalid input syntax for type uuid") — pas de requête tant
    // qu'aucun modèle de produit n'est encore choisi pour cet ODF.
    order.product_model_id
      ? supabase
          .from("product_zone_templates")
          .select("zone_key,zone_label,display_order")
          .eq("product_model_id", order.product_model_id)
          .order("display_order")
      : Promise.resolve({ data: [] as { zone_key: string; zone_label: string; display_order: number }[] }),
    supabase.from("production_order_zone_colors").select("zone_key,color_id").eq("production_order_id", id),
    supabase
      .from("production_order_media_files")
      .select("media_file_id,media_files(id,file_name,category)")
      .eq("production_order_id", id),
    supabase.from("media_files").select("id,file_name,category").eq("company_id", order.company_id),
    // Lot 10 : mouvements de stock & fiches d'import Sage (section 19 du
    // document de logique) — dérivés de record_pesee/create_article_lot,
    // jamais saisis directement (migration 0020).
    supabase
      .from("stock_movements")
      .select("id,production_order_id,type,article_ref,quantite_ou_poids,unite,exported_in_fiche_id,created_by,created_at")
      .eq("production_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("stock_export_fiches")
      .select("id,numero,production_order_id,generated_at,generated_by")
      .eq("production_order_id", id)
      .order("generated_at", { ascending: false }),
    // Lot gestionnaire de stock : article Sage optionnel pour une pesée
    // reception_tissu/retour_stock saisie depuis la partie Stock de l'ODF —
    // même source que le terminal Coupe (peut être vide si jamais
    // synchronisé, cf. Paramètres > Stock).
    supabase.from("stock_item_view").select("sage_reference,designation").order("designation"),
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

  const rend = rendement as {
    pieces_obtenues: number;
    poids_tissu_theorique_kg: number | null;
    theorique_complet: boolean;
    poids_tissu_reel_mesure_kg: number;
    rendement_theorique_pieces_par_kg: number | null;
    rendement_mesure_pieces_par_kg: number | null;
  } | null;

  const company = order.companies as unknown as { name: string } | null;
  const quote = order.quotes as unknown as { reference: string } | null;
  const productModel = order.product_models as unknown as { id: string; name: string } | null;

  // Lot 9 : fichiers déjà joints à l'ODF (visuel/maquette) + ceux encore
  // disponibles dans la médiathèque du client, pour le sélecteur d'ajout.
  const attachedMediaFiles = (attachedMedia ?? [])
    .map((m) => m.media_files as unknown as { id: string; file_name: string; category: MediaFileCategory } | null)
    .filter((f): f is { id: string; file_name: string; category: MediaFileCategory } => !!f);
  const availableMediaFiles = (availableMedia ?? []) as { id: string; file_name: string; category: MediaFileCategory }[];

  const canArchive = await can("ordres_fabrication", "archive");
  const canValidate = await can("ordres_fabrication", "validate");
  const canRequestClosure = profile.role === "responsable_production" || profile.role === "administrateur";
  const isAdmin = profile.role === "administrateur";
  // Réception tissu / sortie lot / retour stock, et génération des fiches
  // d'export Sage — gestionnaire de stock ajouté suite au constat que la
  // section Coupe ne devait pas saisir la réception de marchandise
  // (migrations 0022/0023) : ce n'est plus elle qui le fait, c'est ici.
  const canManageStock = isAdmin || profile.role === "responsable_production" || profile.role === "gestionnaire_stock";
  const stockItemOptions = (stockItems ?? []).map((i) => ({ sageReference: i.sage_reference, designation: i.designation }));

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

      <ProductConfigurator
        productionOrderId={order.id}
        editable={order.status === "brouillon"}
        productModels={productModels ?? []}
        currentProductModelId={order.product_model_id}
        currentProductModelName={productModel?.name ?? null}
        zoneTemplate={zoneTemplate ?? []}
        colors={activeColors ?? []}
        initialZoneColors={zoneColors ?? []}
        initialNote={order.note_disponibilite_couleurs}
      />

      <ProductionOrderMediaFiles
        productionOrderId={order.id}
        attached={attachedMediaFiles}
        available={availableMediaFiles}
      />

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
          description="Un sous-ODF par section retenue, généré à la validation de l'ODF. Cliquez sur un sous-ODF pour son détail."
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
                  <li key={wo.id}>
                    <Link
                      href={`/atelier/production/${order.id}/ot/${wo.id}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-surface-muted"
                    >
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
                      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-muted" />
                    </Link>
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

      {canManageStock && (
        <StockEntryForm
          productionOrderId={order.id}
          articleLots={(articleLots ?? []).map((l) => ({ id: l.id, code: l.code, categorie: l.categorie }))}
          stockItemOptions={stockItemOptions}
        />
      )}

      <StockMovementsPanel
        productionOrderId={order.id}
        movements={(stockMovements ?? []) as StockMovement[]}
        fiches={(stockExportFiches ?? []) as StockExportFiche[]}
        canGenerate={canManageStock}
      />

      {rend && (
        <Card>
          <CardHeader
            title="Rendement matière"
            description="Pièces obtenues par kg de tissu engagé (lot 8) — théorique (dimensions des matelas) vs mesuré (pesées réelles, lot 7)."
          />
          <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-foreground-muted">Pièces obtenues</p>
              <p className="font-medium text-foreground">{rend.pieces_obtenues}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Tissu engagé (théorique)</p>
              <p className="font-medium text-foreground">
                {rend.theorique_complet ? `${rend.poids_tissu_theorique_kg} kg` : "incomplet"}
              </p>
              {!rend.theorique_complet && (
                <p className="text-xs text-foreground-muted">dimension ou grammage manquant sur un matelas</p>
              )}
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Tissu engagé (mesuré)</p>
              <p className="font-medium text-foreground">{rend.poids_tissu_reel_mesure_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Rendement (théorique / mesuré)</p>
              <p className="font-medium text-foreground">
                {rend.rendement_theorique_pieces_par_kg ?? "—"} / {rend.rendement_mesure_pieces_par_kg ?? "—"} pièces/kg
              </p>
            </div>
          </CardBody>
          {rendementTraces && rendementTraces.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {rendementTraces.map((rt) => (
                <li key={rt.trace_id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm text-foreground">{rt.reference}</p>
                    <p className="text-xs text-foreground-muted">
                      {rt.pieces_obtenues} pièces · {rt.rendement_estime_pieces_par_kg ?? "—"} pièces/kg ·
                      {" "}clôturé le {formatDateTime(rt.cloture_le)}
                    </p>
                  </div>
                  <Link
                    href={`/atelier/patronnage/${rt.fiche_id}?trace=${rt.trace_id}`}
                    className="shrink-0 text-xs font-medium text-brand hover:underline"
                  >
                    Voir le tracé →
                  </Link>
                </li>
              ))}
            </ul>
          )}
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
