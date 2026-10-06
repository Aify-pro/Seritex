import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { odfClientLabel } from "@/lib/production/client-label";
import { getSizes } from "@/lib/sizes";
import type { WorkOrderFlowRow } from "@/lib/types/domain";
import { PickingList, type PickingRow } from "../picking-list";

/**
 * Prélèvements à faire (SF-2) : sous-ODF des sections Stock d'ODF en
 * production, avec un reste à prélever — chaque prélèvement crée une sortie
 * PF pour Sage.
 */
export async function PrelevementsTab() {
  const supabase = await createClient();
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
  const rows: PickingRow[] = (stockWos ?? [])
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
  const sizes = await getSizes();

  return (
    <Card>
      <CardHeader
        title={`Prélèvements à faire (${rows.length})`}
        description="Lignes d'ODF qui partent du stock : prélevez les produits finis vierges et déclarez-les par taille — chaque prélèvement crée une sortie PF pour Sage."
      />
      <CardBody className="p-0">
        <PickingList rows={rows} sizes={sizes} />
      </CardBody>
    </Card>
  );
}
