import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";

export default async function CommercialProductionPage() {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  // Vue volontairement restreinte : statut et dates uniquement, jamais les
  // détails internes d'atelier (opérateur assigné, durées réelles, aléas) —
  // cf. client_production_status et section 2.3 de l'analyse fonctionnelle.
  const { data: orders } = await supabase
    .from("client_production_status")
    .select("*,companies:company_id(name)")
    .order("planned_start_date", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Avancement production"
        description="Pour répondre à une relance client sans appeler l'atelier."
      />
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {orders?.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{o.reference}</p>
                  <p className="text-xs text-foreground-muted">
                    {(o as unknown as { companies?: { name: string } }).companies?.name} · {o.total_quantity} pièces
                    {o.section_en_cours ? ` · en ${o.section_en_cours}` : ""}
                  </p>
                </div>
                <span className="text-xs text-foreground-muted">{formatDate(o.planned_end_date)}</span>
                <StatusBadge status={o.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
              </li>
            ))}
            {(!orders || orders.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune commande en production.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
