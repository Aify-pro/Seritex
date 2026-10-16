import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { FilterBar, type FilterField } from "@/components/filters/filter-bar";
import { Presets } from "@/components/filters/presets";
import { ListPagination } from "@/components/filters/pagination";
import { PAGE_SIZES, type ListQuery, type RawParams } from "@/lib/filters/params";
import { REQUEST_SORTS, REQUEST_STATUSES, applyRequestFilters, parseRequestFilters, type RequestSortKey } from "@/lib/demandes/filters";

interface Row {
  id: string;
  reference: string;
  status: string;
  description: string | null;
  created_at: string;
  company_name: string | null;
  prospect_label: string | null;
}

/**
 * Demandes graphiques : les demandes commerciales qui nécessitent un visuel.
 * Mêmes mécanique et vue (requests_list, 0134) que la liste des demandes,
 * restreintes aux demandes à visuel ; statuts multiples, période, préréglages.
 */
export default async function InfographieRequestsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireModule("demandes_graphiques");
  const raw = await searchParams;
  const filters = parseRequestFilters(raw);
  const supabase = await createClient();

  const from = (filters.page - 1) * filters.taille;
  const list = (await applyRequestFilters(
    supabase.from("requests_list").select("id,reference,status,description,created_at,company_name,prospect_label", { count: "exact" }) as unknown as ListQuery,
    filters,
    { forceGraphics: true }
  ).range(from, from + filters.taille - 1)) as { data: Row[] | null; count: number | null; error: { message: string } | null };

  const requests = list.data ?? [];
  const fields: FilterField[] = [
    { kind: "multi", key: "statut", label: "Statut", primary: true, options: REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS[s] })) },
    { kind: "date", key: "du", label: "Créée à partir du" },
    { kind: "date", key: "au", label: "Créée jusqu'au" },
  ];
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));

  return (
    <div className="space-y-6">
      <PageHeader title="Demandes graphiques" description="Demandes commerciales nécessitant un visuel." />

      <div className="space-y-3">
        <Presets module="demandes_graphiques" />
        <FilterBar
          fields={fields}
          sorts={(Object.keys(REQUEST_SORTS) as RequestSortKey[]).map((k) => ({ value: k, label: REQUEST_SORTS[k].label }))}
          defaultSort={{ tri: "date", ordre: "desc" }}
          placeholder="Rechercher : référence, client, description…"
          searchLabel="Rechercher une demande graphique"
          pageSizes={PAGE_SIZES}
        />
      </div>

      {list.error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les demandes ({list.error.message}). Si la migration <code>0134</code> n&apos;est pas encore appliquée, appliquez-la puis rechargez la page.
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {requests.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/infographie/demandes/${r.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {r.reference} · {r.company_name ?? r.prospect_label}
                    </p>
                    <p className="truncate text-xs text-foreground-muted">{r.description}</p>
                  </div>
                  <span className="text-xs text-foreground-muted">{formatDate(r.created_at)}</span>
                  <StatusBadge status={r.status} labels={REQUEST_STATUS_LABELS} kind="request" />
                </Link>
              </li>
            ))}
            {requests.length === 0 && !list.error && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune demande ne correspond.</li>
            )}
          </ul>
        </CardBody>
      </Card>

      <ListPagination basePath="/infographie/demandes" params={params} page={filters.page} taille={filters.taille} total={list.count ?? 0} noun="demande" />
    </div>
  );
}
