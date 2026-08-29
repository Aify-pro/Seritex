import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export default async function InfographieRequestsPage() {
  await requireRole(["infographiste", "administrateur"]);
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("requests")
    .select("id,reference,status,description,created_at,companies(name)")
    .eq("needs_graphics", true)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Demandes graphiques" description="Demandes commerciales nécessitant un visuel." />
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {requests?.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/infographie/demandes/${r.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {r.reference} · {(r.companies as unknown as { name: string } | null)?.name}
                    </p>
                    <p className="truncate text-xs text-foreground-muted">{r.description}</p>
                  </div>
                  <span className="text-xs text-foreground-muted">{formatDate(r.created_at)}</span>
                  <StatusBadge status={r.status} labels={REQUEST_STATUS_LABELS} kind="request" />
                </Link>
              </li>
            ))}
            {(!requests || requests.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune demande en attente.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
