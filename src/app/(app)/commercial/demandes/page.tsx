import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

export default async function RequestsPage() {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("requests")
    .select("id,reference,status,description,created_at,companies(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demandes"
        description="Pipeline commercial — de la demande entrante jusqu'au devis."
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
                      {r.reference} · {(r.companies as unknown as { name: string } | null)?.name}
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
