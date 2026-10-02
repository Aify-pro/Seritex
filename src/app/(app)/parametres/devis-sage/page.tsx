import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import { getSageQuotesLastSync } from "@/lib/sage-quotes";
import { Lock } from "lucide-react";

const LIMITE = 200;

export default async function DevisSagePage() {
  await requireRole(["administrateur", "commercial", "responsable_production"]);
  const supabase = await createClient();

  const [{ data: quotes, count }, lastSync] = await Promise.all([
    supabase
      .from("sage_quotes_view")
      .select("sage_piece,doc_date,client_ref,client_sage_code,total_ht,total_ttc,date_livraison", { count: "exact" })
      .order("doc_date", { ascending: false, nullsFirst: false })
      .limit(LIMITE),
    getSageQuotesLastSync(),
  ]);

  const pieces = (quotes ?? []).map((q) => q.sage_piece as string);
  const codes = Array.from(new Set((quotes ?? []).map((q) => q.client_sage_code as string)));
  const [{ data: customers }, { data: imported }] = await Promise.all([
    codes.length
      ? supabase.from("sage_customers_view").select("sage_code,name").in("sage_code", codes)
      : Promise.resolve({ data: [] as { sage_code: string; name: string }[] }),
    pieces.length
      ? supabase.from("quotes").select("sage_piece,reference").in("sage_piece", pieces)
      : Promise.resolve({ data: [] as { sage_piece: string; reference: string }[] }),
  ]);
  const names = new Map((customers ?? []).map((c) => [c.sage_code as string, c.name as string]));
  const importedAs = new Map((imported ?? []).map((q) => [q.sage_piece as string, q.reference as string]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devis (Sage)"
        description="Devis en cours dans Sage, en lecture seule. Pour en reprendre un, utilisez « Récupérer un devis Sage » depuis la demande du client : il préremplit le devis Seritex et évite la double saisie."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Aucune écriture n&apos;est possible depuis Seritex. Un devis disparaît de cette liste dès qu&apos;il est
          transformé (commande, BL, facture) ou purgé dans Sage. Dernière synchro :{" "}
          {lastSync ? formatDateTime(lastSync) : "jamais"}.
        </span>
      </div>

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Pièce Sage</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Réf. client</th>
                <th className="px-5 py-3 text-right font-medium">Total HT</th>
                <th className="px-5 py-3 text-right font-medium">Total TTC</th>
                <th className="px-5 py-3 font-medium">Livraison</th>
                <th className="px-5 py-3 font-medium">Dans Seritex</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes?.map((q) => {
                const reference = importedAs.get(q.sage_piece);
                return (
                  <tr key={q.sage_piece}>
                    <td className="px-5 py-3 font-mono text-xs text-foreground-muted">{q.sage_piece}</td>
                    <td className="px-5 py-3 text-foreground-muted">{formatDate(q.doc_date)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {names.get(q.client_sage_code) ?? q.client_sage_code}
                    </td>
                    <td className="px-5 py-3 text-foreground-muted">{q.client_ref || "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground-muted">
                      {formatAmount(Number(q.total_ht))}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground-muted">
                      {formatAmount(Number(q.total_ttc))}
                    </td>
                    <td className="px-5 py-3 text-foreground-muted">{formatDate(q.date_livraison)}</td>
                    <td className="px-5 py-3">
                      {reference ? <Badge tone="success">{reference}</Badge> : <Badge tone="neutral">Pas récupéré</Badge>}
                    </td>
                  </tr>
                );
              })}
              {(!quotes || quotes.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    Aucun devis Sage en cours — lancez une synchronisation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
      {(count ?? 0) > LIMITE && (
        <p className="text-xs text-foreground-muted">
          {LIMITE} devis les plus récents affichés sur {count}.
        </p>
      )}
    </div>
  );
}
