import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { odfClientLabel } from "@/lib/production/client-label";
import { STOCK_MOVEMENT_TYPE_LABELS, formatMovementUnit } from "@/lib/stock/movements";
import type { StockMovement, StockExportFiche } from "@/lib/types/domain";
import { StockEntryForm } from "../../production/[id]/stock-entry-form";
import { StockMovementsPanel } from "../../production/[id]/stock-movements-panel";
import { GlobalExportButton } from "../global-export-button";
import { DepotEditor } from "../depot-editor";

/**
 * Mouvements et export Sage : fiches d'export (CSV au format provisoire avec
 * dépôt), 100 derniers mouvements avec leur motif, et la saisie par ODF.
 */
export async function MouvementsTab({ odfId }: { odfId: string | null }) {
  const supabase = await createClient();
  const [{ data: orders }, { count: unexportedCount }, { data: allFiches }, { data: recentMovements }] = await Promise.all([
    // ODF actifs seulement (record_pesee refuse déjà terminee/annulee).
    supabase
      .from("production_orders")
      .select("id,reference,total_quantity,company_id,companies(name)")
      .not("status", "in", "(terminee,annulee)")
      .order("created_at", { ascending: false }),
    supabase.from("stock_movements").select("id", { count: "exact", head: true }).is("exported_in_fiche_id", null),
    supabase
      .from("stock_export_fiches")
      .select("id,numero,production_order_id,generated_at,production_orders(reference),shipments(reference),sage_numero")
      .order("generated_at", { ascending: false })
      .limit(50),
    supabase
      .from("stock_movements")
      .select("id,type,article_ref,quantite_ou_poids,unite,created_at,exported_in_fiche_id,depot,commentaire,production_orders(reference)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const odfOptions = (orders ?? []).map((o) => ({
    id: o.id as string,
    reference: o.reference as string,
    companyName: odfClientLabel(o.company_id as string | null, (o.companies as unknown as { name: string } | null)?.name),
    totalQuantity: o.total_quantity as number,
  }));
  const productionOrderId = odfId ?? null;

  let odfSection: React.ReactNode = null;
  if (productionOrderId) {
    const [{ data: articleLots }, { data: stockItems }, { data: stockMovements }, { data: stockExportFiches }] = await Promise.all([
      supabase.from("article_lots").select("id,code,categorie").eq("production_order_id", productionOrderId).order("created_at", { ascending: false }),
      supabase.from("stock_item_view").select("sage_reference,designation").order("designation"),
      supabase
        .from("stock_movements")
        .select("id,production_order_id,type,article_ref,quantite_ou_poids,unite,exported_in_fiche_id,created_by,created_at,depot,taille,commentaire,shipment_id")
        .eq("production_order_id", productionOrderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("stock_export_fiches")
        .select("id,numero,production_order_id,generated_at,generated_by")
        .eq("production_order_id", productionOrderId)
        .order("generated_at", { ascending: false }),
    ]);
    odfSection = (
      <>
        <StockEntryForm
          productionOrderId={productionOrderId}
          articleLots={(articleLots ?? []).map((l) => ({ id: l.id, code: l.code, categorie: l.categorie }))}
          stockItemOptions={(stockItems ?? []).map((i) => ({ sageReference: i.sage_reference, designation: i.designation }))}
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
      <Card>
        <CardHeader
          title="Export Sage"
          description="Génère un CSV (format provisoire, avec dépôt) à partir des mouvements pas encore exportés. Chaque mouvement doit porter un dépôt : pré-rempli selon la nature (Paramètres > Codification), modifiable ci-dessous."
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
                  const bl = (f.shipments as unknown as { reference: string | null } | null)?.reference ?? null;
                  return (
                    <Tr key={f.id}>
                      <Td>
                        <Link href={`/stock/fiches/${f.numero}`} className="font-mono text-xs font-medium text-brand hover:underline">
                          {f.numero}
                        </Link>
                      </Td>
                      <Td>{bl ? `BL ${bl}` : po ? po.reference : "Global"}</Td>
                      <Td>{formatDate(f.generated_at)}</Td>
                      <Td>
                        <Badge tone={f.sage_numero ? "success" : "warning"}>{f.sage_numero ? "Rapproché" : "En attente"}</Badge>
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
        <CardHeader title="Mouvements récents — toutes ODF" description="100 derniers mouvements, avec leur motif (ex. « Coupe pour ODF … — rouleau … »)." />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>ODF</Th>
                <Th>Référence Sage</Th>
                <Th align="right">Quantité</Th>
                <Th>Motif</Th>
                <Th>Dépôt</Th>
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
                    {m.quantite_ou_poids} {formatMovementUnit(m.unite)}
                  </Td>
                  <Td className="max-w-xs text-xs text-foreground-muted">{(m.commentaire as string | null) ?? "—"}</Td>
                  <Td>
                    <DepotEditor movementId={m.id} depot={(m.depot as string | null) ?? null} editable={!m.exported_in_fiche_id} />
                  </Td>
                  <Td>
                    <Badge tone={m.exported_in_fiche_id ? "neutral" : "warning"}>{m.exported_in_fiche_id ? "Exporté" : "Non exporté"}</Badge>
                  </Td>
                </Tr>
              ))}
              {(!recentMovements || recentMovements.length === 0) && <EmptyRow colSpan={8}>Aucun mouvement pour le moment.</EmptyRow>}
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
                <ClickableTr key={o.id} href={`/atelier/stock?onglet=mouvements&odf=${o.id}`} className={o.id === productionOrderId ? "bg-brand-soft/40" : undefined}>
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
