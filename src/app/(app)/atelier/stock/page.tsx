import { STOCK_MOVEMENT_TYPE_LABELS } from "@/lib/stock/movements";
import { requireRole } from "@/lib/auth/current-user";
import { odfClientLabel } from "@/lib/production/client-label";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/utils";
import { StockEntryForm } from "../production/[id]/stock-entry-form";
import { StockMovementsPanel } from "../production/[id]/stock-movements-panel";
import { GlobalExportButton } from "./global-export-button";
import { PickingList, type PickingRow } from "./picking-list";
import { getSizes } from "@/lib/sizes";
import type { WorkOrderFlowRow } from "@/lib/types/domain";
import type { StockMovement, StockExportFiche } from "@/lib/types/domain";

/**
 * Gestion de stock — saisie déjà déplacée hors de l'ODF (demande Ayman
 * 16/09), complétée ici par une vue d'ensemble (la plupart des mouvements
 * sont en réalité saisis depuis les terminaux de section, pas cet écran) et
 * l'export Sage (migration 0038) : CSV par ODF ou global, puis rapprochement
 * une fois importé côté Sage. `record_pesee`/`generate_stock_export_fiche`/
 * `record_sage_reconciliation` autorisent déjà exactement les trois rôles
 * ci-dessous.
 */
export default async function StockManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ odf?: string }>;
}) {
  await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: orders }, { count: unexportedCount }, { data: allFiches }, { data: recentMovements }] =
    await Promise.all([
      // ODF actifs seulement (record_pesee refuse déjà terminee/annulee) — un
      // ODF clôturé n'a plus de mouvement à enregistrer.
      supabase
        .from("production_orders")
        .select("id,reference,total_quantity,company_id,companies(name)")
        .not("status", "in", "(terminee,annulee)")
        .order("created_at", { ascending: false }),
      supabase.from("stock_movements").select("id", { count: "exact", head: true }).is("exported_in_fiche_id", null),
      supabase
        .from("stock_export_fiches")
        .select("id,numero,production_order_id,generated_at,production_orders(reference),sage_numero")
        .order("generated_at", { ascending: false })
        .limit(50),
      supabase
        .from("stock_movements")
        .select("id,type,article_ref,quantite_ou_poids,unite,created_at,exported_in_fiche_id,production_orders(reference)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const odfOptions = (orders ?? []).map((o) => ({
    id: o.id as string,
    reference: o.reference as string,
    companyName: odfClientLabel(o.company_id as string | null, (o.companies as unknown as { name: string } | null)?.name),
    totalQuantity: o.total_quantity as number,
  }));

  const productionOrderId = params.odf ?? odfOptions[0]?.id ?? null;

  // Prélèvements à faire (SF-2) : sous-ODF des sections Stock d'ODF en
  // production, avec un reste à prélever.
  const { data: stockWos } = await supabase
    .from("work_orders")
    .select("id,reference,production_order_line_id,sections!inner(atelier_categories!inner(cle)),production_orders!inner(reference,status,company_id,companies(name))")
    .eq("sections.atelier_categories.cle", "stock")
    .eq("production_orders.status", "en_production");
  const stockWoIds = (stockWos ?? []).map((w) => w.id as string);
  const [{ data: stockFlows }, { data: stockLines }] = stockWoIds.length
    ? await Promise.all([
        supabase.rpc("work_orders_flow", { p_work_order_ids: stockWoIds }),
        supabase.from("production_order_lines").select("id,description").in("id", (stockWos ?? []).map((w) => w.production_order_line_id as string)),
      ])
    : [{ data: [] }, { data: [] }];
  const pickingRows: PickingRow[] = (stockWos ?? [])
    .map((w) => {
      const po = w.production_orders as unknown as { reference: string; company_id: string | null; companies: { name: string } | null };
      return {
        workOrderId: w.id as string,
        reference: w.reference as string,
        odfReference: po.reference,
        client: odfClientLabel(po.company_id, po.companies?.name),
        article: (stockLines ?? []).find((l) => l.id === w.production_order_line_id)?.description ?? "Article",
        flow: ((stockFlows ?? []) as (WorkOrderFlowRow & { work_order_id: string })[]).filter((f) => f.work_order_id === w.id),
      };
    })
    .filter((r) => r.flow.some((f) => f.reste > 0));
  const allSizes = await getSizes();

  let odfSection: React.ReactNode = null;
  if (productionOrderId) {
    const [{ data: articleLots }, { data: stockItems }, { data: stockMovements }, { data: stockExportFiches }] =
      await Promise.all([
        supabase
          .from("article_lots")
          .select("id,code,categorie")
          .eq("production_order_id", productionOrderId)
          .order("created_at", { ascending: false }),
        supabase.from("stock_item_view").select("sage_reference,designation").order("designation"),
        supabase
          .from("stock_movements")
          .select("id,production_order_id,type,article_ref,quantite_ou_poids,unite,exported_in_fiche_id,created_by,created_at")
          .eq("production_order_id", productionOrderId)
          .order("created_at", { ascending: false }),
        supabase
          .from("stock_export_fiches")
          .select("id,numero,production_order_id,generated_at,generated_by")
          .eq("production_order_id", productionOrderId)
          .order("generated_at", { ascending: false }),
      ]);

    const stockItemOptions = (stockItems ?? []).map((i) => ({ sageReference: i.sage_reference, designation: i.designation }));

    odfSection = (
      <>
        <StockEntryForm
          productionOrderId={productionOrderId}
          articleLots={(articleLots ?? []).map((l) => ({ id: l.id, code: l.code, categorie: l.categorie }))}
          stockItemOptions={stockItemOptions}
        />
        <StockMovementsPanel
          productionOrderId={productionOrderId}
          movements={(stockMovements ?? []) as StockMovement[]}
          fiches={(stockExportFiches ?? []) as StockExportFiche[]}
          canGenerate
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion de stock"
        description="Réceptions, sorties et retours de matière — la plupart des mouvements sont saisis depuis les terminaux de section ; cet écran donne la vue d'ensemble et l'export Sage."
      />

      <Card>
        <CardHeader
          title={`Prélèvements à faire (${pickingRows.length})`}
          description="Lignes d'ODF qui partent du stock : prélevez les produits finis vierges et déclarez-les par taille — chaque prélèvement crée une sortie PF pour Sage."
        />
        <CardBody className="p-0">
          <PickingList rows={pickingRows} sizes={allSizes} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Export Sage"
          description="Génère un CSV au format d'import Sage à partir des mouvements pas encore exportés."
          action={<GlobalExportButton unexportedCount={unexportedCount ?? 0} />}
        />
        <CardBody className="p-0">
          {!allFiches || allFiches.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucune fiche d&apos;export générée pour le moment.</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>N° fiche</Th>
                  <Th>Portée</Th>
                  <Th>Générée le</Th>
                  <Th>Statut Sage</Th>
                </Tr>
              </Thead>
              <Tbody>
                {allFiches.map((f) => {
                  const po = f.production_orders as unknown as { reference: string } | null;
                  return (
                    <Tr key={f.id}>
                      <Td>
                        <Link href={`/stock/fiches/${f.numero}`} className="font-mono text-xs font-medium text-brand hover:underline">
                          {f.numero}
                        </Link>
                      </Td>
                      <Td>{po ? po.reference : "Global"}</Td>
                      <Td>{formatDate(f.generated_at)}</Td>
                      <Td>
                        <Badge tone={f.sage_numero ? "success" : "warning"}>
                          {f.sage_numero ? "Rapproché" : "En attente"}
                        </Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mouvements récents — toutes ODF" description="Vue d'ensemble en lecture seule, 100 derniers mouvements." />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>ODF</Th>
                <Th>Référence Sage</Th>
                <Th align="right">Quantité</Th>
                <Th>Export</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(recentMovements ?? []).map((m) => (
                <Tr key={m.id}>
                  <Td>{formatDateTime(m.created_at)}</Td>
                  <Td>{STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</Td>
                  <Td>{(m.production_orders as unknown as { reference: string } | null)?.reference ?? "—"}</Td>
                  <Td className="font-mono text-xs">{m.article_ref ?? "—"}</Td>
                  <Td align="right">
                    {m.quantite_ou_poids} {m.unite === "kg" ? "kg" : "pièce(s)"}
                  </Td>
                  <Td>
                    <Badge tone={m.exported_in_fiche_id ? "neutral" : "warning"}>
                      {m.exported_in_fiche_id ? "Exporté" : "Non exporté"}
                    </Badge>
                  </Td>
                </Tr>
              ))}
              {(!recentMovements || recentMovements.length === 0) && <EmptyRow colSpan={6}>Aucun mouvement pour le moment.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Par ordre de fabrication" description="Sélectionnez un ODF pour saisir un mouvement ou consulter son historique." />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Référence</Th>
                <Th>Client</Th>
                <Th align="right">Quantité</Th>
              </Tr>
            </Thead>
            <Tbody>
              {odfOptions.map((o) => (
                <ClickableTr
                  key={o.id}
                  href={`/atelier/stock?odf=${o.id}`}
                  className={o.id === productionOrderId ? "bg-brand-soft/40" : undefined}
                >
                  <Td>{o.reference}</Td>
                  <Td>{o.companyName ?? "—"}</Td>
                  <Td align="right">{o.totalQuantity} pièces</Td>
                </ClickableTr>
              ))}
              {odfOptions.length === 0 && <EmptyRow colSpan={3}>Aucun ordre de fabrication actif pour le moment.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      {odfSection}
    </div>
  );
}
