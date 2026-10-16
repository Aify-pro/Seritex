import { requireAnyModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { FilterBar, type FilterField } from "@/components/filters/filter-bar";
import { Presets } from "@/components/filters/presets";
import { ListPagination } from "@/components/filters/pagination";
import { PAGE_SIZES, type ListQuery, type RawParams } from "@/lib/filters/params";
import {
  REQUEST_KINDS,
  REQUEST_SORTS,
  REQUEST_SOURCES,
  REQUEST_STATUSES,
  applyRequestFilters,
  parseRequestFilters,
  type RequestSortKey,
} from "@/lib/demandes/filters";
import { listeCommerciaux } from "@/lib/demandes/commerciaux";

interface RequestRow {
  id: string;
  reference: string;
  status: string;
  description: string | null;
  created_at: string;
  company_id: string | null;
  company_name: string | null;
  prospect_label: string | null;
  kind: "client" | "a_rattacher" | "stock";
  source: string | null;
  needs_graphics: boolean;
  commercial_name: string | null;
  quote_count: number;
}

/**
 * Demandes : celles des clients, celles du site web (0098, « Client à
 * rattacher » tant que le prospect n'est pas relié à sa fiche Sage) et celles
 * pour le stock (SF-3), dans une seule liste. La production n'y voit que les demandes pour le stock (RLS).
 * Recherche, filtres (statuts multiples, origine, commercial, période…), tri et
 * pagination s'exécutent en base (vue requests_list, 0134) ; l'état est dans
 * l'URL et se retient en préréglages au-dessus de la liste.
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAnyModule(["demandes", "demandes_stock"]);
  const raw = await searchParams;
  const filters = parseRequestFilters(raw);
  const supabase = await createClient();

  const from = (filters.page - 1) * filters.taille;
  const [list, commerciaux] = await Promise.all([
    applyRequestFilters(
      supabase
        .from("requests_list")
        .select("id,reference,status,description,created_at,company_id,company_name,prospect_label,kind,source,needs_graphics,commercial_name,quote_count", {
          count: "exact",
        }) as unknown as ListQuery,
      filters
    ).range(from, from + filters.taille - 1) as PromiseLike<{ data: RequestRow[] | null; count: number | null; error: { message: string; code?: string } | null }>,
    listeCommerciaux(),
  ]);

  const requests = list.data ?? [];
  const total = list.count ?? 0;

  const fields: FilterField[] = [
    { kind: "multi", key: "statut", label: "Statut", primary: true, options: REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS[s] })) },
    {
      kind: "select",
      key: "kind",
      label: "Type de demande",
      placeholder: "Tous",
      options: Object.entries(REQUEST_KINDS).map(([value, label]) => ({ value, label })),
    },
    {
      kind: "select",
      key: "source",
      label: "Provenance",
      placeholder: "Toutes",
      options: Object.entries(REQUEST_SOURCES).map(([value, label]) => ({ value, label })),
    },
    {
      kind: "select",
      key: "commercial",
      label: "Commercial",
      placeholder: "Tous",
      options: [{ value: "aucun", label: "Non assignée" }, ...commerciaux.map((c) => ({ value: c.id, label: c.nom }))],
    },
    { kind: "select", key: "graphique", label: "Visuel graphique", placeholder: "Peu importe", options: [{ value: "oui", label: "Avec visuel à produire" }, { value: "non", label: "Sans visuel" }] },
    { kind: "select", key: "devis", label: "Devis", placeholder: "Peu importe", options: [{ value: "avec", label: "Avec devis" }, { value: "sans", label: "Sans devis" }] },
    { kind: "date", key: "du", label: "Créée à partir du" },
    { kind: "date", key: "au", label: "Créée jusqu'au" },
  ];

  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));

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

      <div className="space-y-3">
        <Presets module="demandes" />
        <FilterBar
          fields={fields}
          sorts={(Object.keys(REQUEST_SORTS) as RequestSortKey[]).map((k) => ({ value: k, label: REQUEST_SORTS[k].label }))}
          defaultSort={{ tri: "date", ordre: "desc" }}
          placeholder="Rechercher : référence, client, prospect, description…"
          searchLabel="Rechercher une demande"
          pageSizes={PAGE_SIZES}
        />
      </div>

      {list.error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les demandes ({list.error.message}). Si la migration <code>0134</code> n&apos;est pas encore appliquée sur la base,
          appliquez-la puis rechargez la page.
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {requests.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/commercial/demandes/${r.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {r.reference} ·{" "}
                      {r.kind === "client" ? (
                        r.company_name
                      ) : r.kind === "a_rattacher" ? (
                        <>
                          {r.prospect_label} <Badge tone="warning">Client à rattacher</Badge>
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
                      {r.needs_graphics && (
                        <>
                          {" "}
                          <Badge tone="accent">Visuel</Badge>
                        </>
                      )}
                    </p>
                    <p className="truncate text-xs text-foreground-muted">{r.description}</p>
                    <p className="text-xs text-foreground-muted">
                      {r.commercial_name ? `Suivie par ${r.commercial_name}` : "Non assignée"}
                      {r.quote_count > 0 && ` · ${r.quote_count} devis`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-foreground-muted">{formatDate(r.created_at)}</span>
                  <StatusBadge status={r.status} labels={REQUEST_STATUS_LABELS} kind="request" />
                  <ArrowRight className="h-4 w-4 shrink-0 text-foreground-muted" />
                </Link>
              </li>
            ))}
            {requests.length === 0 && !list.error && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune demande ne correspond.</li>
            )}
          </ul>
        </CardBody>
      </Card>

      <ListPagination basePath="/commercial/demandes" params={params} page={filters.page} taille={filters.taille} total={total} noun="demande" />
    </div>
  );
}
