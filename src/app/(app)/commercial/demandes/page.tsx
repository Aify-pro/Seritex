import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

/**
 * Demandes : celles des clients, celles du site web (0098, « Client à
 * rattacher » tant que le prospect n'est pas relié à sa fiche Sage) et celles
 * pour le stock (SF-3), dans une seule liste. La production n'y voit que les demandes pour le stock (RLS).
 */
export default async function RequestsPage() {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("requests")
    .select("id,reference,status,description,created_at,company_id,source,prospect,companies(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demandes"
        description="Demandes des clients, jusqu'au devis, et demandes pour le stock, jusqu'à l'ODF de stock."
        action={
          <Link
            href="/commercial/demandes/nouvelle"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90"
          >
            <Plus className="h-4 w-4" /> Nouvelle demande
          </Link>
        }
      />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {requests?.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/commercial/demandes/${r.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {r.reference} ·{" "}
                      {r.company_id ? (
                        (r.companies as unknown as { name: string } | null)?.name
                      ) : r.prospect ? (
                        <>
                          {(r.prospect as { entreprise?: string | null; nom: string }).entreprise ??
                            (r.prospect as { nom: string }).nom}{" "}
                          <Badge tone="warning">Client à rattacher</Badge>
                        </>
                      ) : (
                        <Badge tone="info">Pour le stock</Badge>
                      )}
                      {r.source === "site" && (
                        <>
                          {" "}
                          <Badge tone="neutral">Site web</Badge>
                        </>
                      )}
                    </p>
                    <p className="truncate text-xs text-foreground-muted">{r.description}</p>
                  </div>
                  <span className="shrink-0 text-xs text-foreground-muted">{formatDate(r.created_at)}</span>
                  <StatusBadge status={r.status} labels={REQUEST_STATUS_LABELS} kind="request" />
                  <ArrowRight className="h-4 w-4 shrink-0 text-foreground-muted" />
                </Link>
              </li>
            ))}
            {(!requests || requests.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune demande.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
