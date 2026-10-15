import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ETAT_COMMANDE_LABELS, type EtatCommande } from "@/lib/client-suivi";
import { formatDate } from "@/lib/utils";

export default async function ClientProductionPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("client_commandes")
    .select("id,reference,etat,total_quantity,planned_end_date,section_en_cours")
    .eq("company_id", profile.company_id!)
    .order("created_at", { ascending: false });

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
                <Badge tone={o.etat === "terminee" ? "success" : "brand"}>{ETAT_COMMANDE_LABELS[o.etat as EtatCommande]}</Badge>
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
