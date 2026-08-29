import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS } from "@/lib/types/domain";
import { formatAmount, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function QuotesPage() {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const { data: quotes } = await supabase
    .from("quotes")
    .select("id,reference,status,total_amount,created_at,companies(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Devis" description="Tous les devis émis, tous clients confondus." />
      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Référence</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Montant</th>
                <th className="px-5 py-3 font-medium">Statut</th>
                <th className="px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes?.map((q) => (
                <tr key={q.id} className="hover:bg-surface-muted/60">
                  <td className="px-5 py-3">
                    <Link href={`/commercial/devis/${q.id}`} className="font-medium text-foreground hover:text-brand">
                      {q.reference}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {(q.companies as unknown as { name: string } | null)?.name}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{formatAmount(q.total_amount)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={q.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{formatDate(q.created_at)}</td>
                </tr>
              ))}
              {(!quotes || quotes.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    Aucun devis.
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
