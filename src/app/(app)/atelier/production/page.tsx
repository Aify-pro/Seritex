import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function ProductionOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ archives?: string }>;
}) {
  await requireRole(["responsable_production", "administrateur"]);
  const { archives } = await searchParams;
  const showArchived = archives === "1";
  const supabase = await createClient();

  let query = supabase
    .from("production_orders")
    .select("id,reference,status,total_quantity,planned_start_date,planned_end_date,archived_at,companies(name)")
    .order("created_at", { ascending: false });
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const { data: orders } = await query;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ordres de fabrication"
        description="Un devis accepté génère un ordre de fabrication à lancer, puis ses ordres de travail par section."
        action={
          <Link
            href={showArchived ? "/atelier/production" : "/atelier/production?archives=1"}
            className="text-xs font-medium text-brand hover:underline"
          >
            {showArchived ? "← Voir les ODF actifs" : "Voir les ODF archivés"}
          </Link>
        }
      />

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Référence</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Quantité</th>
                <th className="px-5 py-3 font-medium">Statut</th>
                <th className="px-5 py-3 font-medium">Fin planifiée</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders?.map((o) => (
                <tr key={o.id} className="hover:bg-surface-muted/60">
                  <td className="px-5 py-3 font-medium text-foreground">
                    {o.reference}
                    {o.archived_at && (
                      <Badge tone="neutral" className="ml-2">
                        Archivé
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {(o.companies as unknown as { name: string } | null)?.name}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{o.total_quantity} pièces</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={o.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{formatDate(o.planned_end_date)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/atelier/production/${o.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                    >
                      Détail <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {showArchived ? "Aucun ordre de fabrication archivé." : "Aucun ordre de fabrication pour le moment."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
