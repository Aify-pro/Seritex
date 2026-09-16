import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StockEntryForm } from "../production/[id]/stock-entry-form";
import { StockMovementsPanel } from "../production/[id]/stock-movements-panel";
import { OdfSwitcher } from "./odf-switcher";
import type { StockMovement, StockExportFiche } from "@/lib/types/domain";

/**
 * Écran dédié du gestionnaire de stock (+ responsable_production/
 * administrateur en override) pour saisir les mouvements de stock — sorti
 * de la fiche ODF (demande Ayman 16/09) : celle-ci ne fait plus que les
 * consulter, la saisie se fait ici, ODF choisi via le sélecteur plutôt que
 * de naviguer fiche par fiche. `record_pesee`/`generate_stock_export_fiche`
 * (migration 0023) autorisent déjà exactement ces trois rôles — aucun
 * changement côté base nécessaire.
 */
export default async function StockMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ odf?: string }>;
}) {
  await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const params = await searchParams;
  const supabase = await createClient();

  // ODF actifs seulement (record_pesee refuse déjà terminee/annulee) — un ODF
  // clôturé n'a plus de mouvement à enregistrer.
  const { data: orders } = await supabase
    .from("production_orders")
    .select("id,reference,companies(name)")
    .not("status", "in", "(terminee,annulee)")
    .order("created_at", { ascending: false });

  const odfOptions = (orders ?? []).map((o) => ({
    id: o.id as string,
    reference: o.reference as string,
    companyName: (o.companies as unknown as { name: string } | null)?.name ?? null,
  }));

  const productionOrderId = params.odf ?? odfOptions[0]?.id ?? null;

  if (!productionOrderId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Mouvements de stock"
          description="Réceptions, sorties et retours de matière, par ordre de fabrication."
        />
        <Card>
          <CardBody>Aucun ordre de fabrication actif pour le moment.</CardBody>
        </Card>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mouvements de stock"
        description="Réceptions, sorties et retours de matière, par ordre de fabrication."
        action={<OdfSwitcher options={odfOptions} value={productionOrderId} />}
      />

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
    </div>
  );
}
