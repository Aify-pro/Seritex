import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS } from "@/lib/types/domain";
import { formatAmount, formatDate } from "@/lib/utils";
import Link from "next/link";
import { FilterBar, type FilterField } from "@/components/filters/filter-bar";
import { Presets } from "@/components/filters/presets";
import { ListPagination } from "@/components/filters/pagination";
import { PAGE_SIZES, type ListQuery, type RawParams } from "@/lib/filters/params";
import { QUOTE_SORTS, QUOTE_STATUSES, QUOTE_VALIDITES, applyQuoteFilters, parseQuoteFilters, type QuoteSortKey } from "@/lib/devis/filters";
import { listeCommerciaux } from "@/lib/demandes/commerciaux";
import { aujourdhuiAbidjan } from "@/lib/prospection/constantes";

interface Row {
  id: string;
  reference: string;
  status: string;
  total_amount: number;
  devise: string;
  valid_until: string | null;
  created_at: string;
  company_name: string | null;
  request_reference: string | null;
}

/**
 * Devis : tous les devis émis, tous clients confondus. Recherche, statuts
 * multiples, période, montant, validité, tri et pagination s'exécutent en
 * base (vue quotes_list, 0134) ; l'état est dans l'URL et se retient en
 * préréglages au-dessus de la liste.
 */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireModule("devis");
  const raw = await searchParams;
  const filters = parseQuoteFilters(raw);
  const today = aujourdhuiAbidjan();
  const supabase = await createClient();

  const from = (filters.page - 1) * filters.taille;
  const [list, createurs] = await Promise.all([
    applyQuoteFilters(
      supabase
        .from("quotes_list")
        .select("id,reference,status,total_amount,devise,valid_until,created_at,company_name,request_reference", { count: "exact" }) as unknown as ListQuery,
      filters,
      today
    ).range(from, from + filters.taille - 1) as PromiseLike<{ data: Row[] | null; count: number | null; error: { message: string } | null }>,
    listeCommerciaux(),
  ]);

  const quotes = list.data ?? [];
  const fields: FilterField[] = [
    { kind: "multi", key: "statut", label: "Statut", primary: true, options: QUOTE_STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS_LABELS[s] })) },
    {
      kind: "select",
      key: "validite",
      label: "Validité",
      placeholder: "Peu importe",
      options: Object.entries(QUOTE_VALIDITES).map(([value, label]) => ({ value, label })),
    },
    { kind: "select", key: "createur", label: "Créé par", placeholder: "Tous", options: createurs.map((c) => ({ value: c.id, label: c.nom })) },
    { kind: "date", key: "du", label: "Créé à partir du" },
    { kind: "date", key: "au", label: "Créé jusqu'au" },
    { kind: "number", key: "min", label: "Montant minimum" },
    { kind: "number", key: "max", label: "Montant maximum" },
  ];
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));

  return (
    <div className="space-y-6">
      <PageHeader title="Devis" description="Tous les devis émis, tous clients confondus." />

      <div className="space-y-3">
        <Presets module="devis" />
        <FilterBar
          fields={fields}
          sorts={(Object.keys(QUOTE_SORTS) as QuoteSortKey[]).map((k) => ({ value: k, label: QUOTE_SORTS[k].label }))}
          defaultSort={{ tri: "date", ordre: "desc" }}
          placeholder="Rechercher : référence du devis, client, demande, pièce Sage…"
          searchLabel="Rechercher un devis"
          pageSizes={PAGE_SIZES}
        />
      </div>

      {list.error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les devis ({list.error.message}). Si la migration <code>0134</code> n&apos;est pas encore appliquée, appliquez-la puis rechargez la page.
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Référence</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Montant</th>
                <th className="px-5 py-3 font-medium">Statut</th>
                <th className="px-5 py-3 font-medium">Validité</th>
                <th className="px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.map((q) => {
                const depassee = q.valid_until !== null && q.valid_until < today && ["envoye", "brouillon", "en_validation_interne"].includes(q.status);
                return (
                  <tr key={q.id} className="hover:bg-surface-muted/60">
                    <td className="px-5 py-3">
                      <Link href={`/commercial/devis/${q.id}`} className="font-medium text-foreground hover:text-brand">
                        {q.reference}
                      </Link>
                      {q.request_reference && <p className="text-xs text-foreground-muted">{q.request_reference}</p>}
                    </td>
                    <td className="px-5 py-3 text-foreground-muted">{q.company_name}</td>
                    <td className="px-5 py-3 text-foreground-muted">{formatAmount(q.total_amount, q.devise)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={q.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
                    </td>
                    <td className={`px-5 py-3 ${depassee ? "font-medium text-danger" : "text-foreground-muted"}`}>
                      {q.valid_until ? formatDate(q.valid_until) : "—"}
                    </td>
                    <td className="px-5 py-3 text-foreground-muted">{formatDate(q.created_at)}</td>
                  </tr>
                );
              })}
              {quotes.length === 0 && !list.error && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    Aucun devis ne correspond.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <ListPagination basePath="/commercial/devis" params={params} page={filters.page} taille={filters.taille} total={list.count ?? 0} noun="devis" />
    </div>
  );
}
