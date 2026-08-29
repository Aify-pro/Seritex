import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";

export default async function ClientProductionPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("client_production_status")
    .select("*")
    .eq("company_id", profile.company_id!)
    .order("planned_start_date", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suivi de commande"
        description="Avancement de vos commandes en fabrication — vue simplifiée."
      />
      <Card>
        <CardBody className="space-y-4 p-5">
          {orders?.map((o) => (
            <div key={o.id} className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{o.reference}</p>
                <StatusBadge status={o.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
              </div>
              <p className="mt-1 text-xs text-foreground-muted">
                {o.total_quantity} pièces
                {o.section_en_cours ? ` · actuellement en ${o.section_en_cours}` : ""}
              </p>
              <p className="mt-1 text-xs text-foreground-muted">
                Livraison prévue : {formatDate(o.planned_end_date)}
              </p>
            </div>
          ))}
          {(!orders || orders.length === 0) && (
            <p className="py-6 text-center text-sm text-foreground-muted">Aucune commande en production.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
