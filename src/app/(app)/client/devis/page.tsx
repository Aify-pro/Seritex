import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS } from "@/lib/types/domain";
import { formatAmount, formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function ClientQuotesPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();

  const { data: quotes } = await supabase
    .from("quotes")
    .select("id,reference,status,total_amount,created_at")
    .eq("company_id", profile.company_id!)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Mes devis" description="Consultez et validez vos propositions commerciales." />
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {quotes?.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/client/devis/${q.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted/60"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{q.reference}</p>
                    <p className="text-xs text-foreground-muted">{formatDate(q.created_at)}</p>
                  </div>
                  <span className="text-sm font-medium text-foreground">{formatAmount(q.total_amount)}</span>
                  <StatusBadge status={q.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
                  <ArrowRight className="h-4 w-4 text-foreground-muted" />
                </Link>
              </li>
            ))}
            {(!quotes || quotes.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucun devis pour le moment.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
