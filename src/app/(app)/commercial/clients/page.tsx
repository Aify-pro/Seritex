import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  EMPTY_FILTER_OPTIONS,
  activeFilterCount,
  applyClientFilters,
  filtersToSearchParams,
  parseClientFilters,
  type ClientFilterOptions,
  type ClientQuery,
} from "@/lib/clients/filters";
import { ClientsFilters } from "./clients-filters";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

interface ClientRow {
  id: string;
  name: string;
  sage_code: string | null;
  origin: "sage" | "manuel";
  famille: string | null;
  zone: string | null;
  city: string | null;
  phone: string | null;
  representant_name: string | null;
  is_prospect: boolean;
  statut: "actif" | "sommeil" | "archive";
  contact_count: number;
  active_contact_count: number;
  open_request_count: number;
  open_odf_count: number;
  last_activity_at: string | null;
}

const nf = new Intl.NumberFormat("fr-FR");

/**
 * Liste des clients (module Clients) : `companies` alimentée par Sage (migrations
 * 0059/0060) avec recherche, filtres, tri et pagination exécutés côté base —
 * la liste tient sans problème plusieurs milliers de fiches. L'état des filtres
 * vit dans l'URL ; l'export CSV (`/api/clients/export`) applique exactement les mêmes.
 */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const filters = parseClientFilters(await searchParams);
  const supabase = await createClient();

  const from = (filters.page - 1) * filters.taille;
  const to = from + filters.taille - 1;

  const [list, optionsRes, syncRes] = await Promise.all([
    applyClientFilters(
      supabase
        .from("companies_list")
        .select(
          "id,name,sage_code,origin,famille,zone,city,phone,representant_name,is_prospect,statut,contact_count,active_contact_count,open_request_count,open_odf_count,last_activity_at",
          { count: "exact" }
        ) as unknown as ClientQuery,
      filters
    ).range(from, to),
    supabase.rpc("company_filter_options"),
    supabase.from("sage_customers_view").select("last_sync_at").order("last_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Page demandée au-delà de la dernière (filtre resserré depuis) : retour à la première page.
  if (list.error?.code === "PGRST103" && filters.page > 1) {
    const qs = filtersToSearchParams(filters, { page: 1 }).toString();
    redirect(qs ? `/commercial/clients?${qs}` : "/commercial/clients");
  }

  const rows = (list.data ?? []) as unknown as ClientRow[];
  const total = list.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.taille));
  const options = (optionsRes.data as ClientFilterOptions | null) ?? EMPTY_FILTER_OPTIONS;
  const activeCount = activeFilterCount(filters);
  const lastSync = (syncRes.data as { last_sync_at: string } | null)?.last_sync_at ?? null;

  const exportQs = filtersToSearchParams(filters, { page: 1 }).toString();
  const pageHref = (page: number) => {
    const qs = filtersToSearchParams(filters, { page }).toString();
    return qs ? `/commercial/clients?${qs}` : "/commercial/clients";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={
          lastSync
            ? `Clients importés de Sage — dernière synchronisation le ${formatDateTime(lastSync)}. Les contacts sont gérés dans Seritex.`
            : "Fiches clients — les contacts sont gérés dans Seritex."
        }
        action={
          <a
            href={`/api/clients/export${exportQs ? `?${exportQs}` : ""}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            <Download className="h-3.5 w-3.5" /> Exporter en CSV
          </a>
        }
      />

      <ClientsFilters values={filters} options={options} activeCount={activeCount} />

      {list.error && list.error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger la liste des clients ({list.error.message}). Si la migration <code>0060</code> n&apos;est pas encore
          appliquée sur la base, appliquez-la puis rechargez la page.
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs text-foreground-muted">
            <span>
              {total === 0
                ? "Aucun client"
                : `${nf.format(from + 1)}–${nf.format(Math.min(to + 1, total))} sur ${nf.format(total)} client${total > 1 ? "s" : ""}`}
              {activeCount > 0 && " (filtré)"}
            </span>
            <span>
              Page {nf.format(Math.min(filters.page, totalPages))} / {nf.format(totalPages)}
            </span>
          </div>
          <Table>
            <Thead>
              <Tr>
                <Th>Client</Th>
                <Th>Famille / zone</Th>
                <Th>Ville</Th>
                <Th>Téléphone</Th>
                <Th>Commercial</Th>
                <Th align="center">Contacts</Th>
                <Th>En cours</Th>
                <Th>Dernière activité</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((c) => (
                <ClickableTr key={c.id} href={`/commercial/clients/${c.id}`}>
                  <Td>
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
                      {c.sage_code ? <span className="font-mono">{c.sage_code}</span> : <Badge tone="info">Hors Sage</Badge>}
                      {c.is_prospect && <Badge tone="accent">Prospect</Badge>}
                      {c.statut === "sommeil" && <Badge tone="warning">En sommeil</Badge>}
                      {c.statut === "archive" && <Badge tone="danger">Disparu de Sage</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <div>{c.famille ?? "—"}</div>
                    {c.zone && <div className="text-xs text-foreground-muted">{c.zone}</div>}
                  </Td>
                  <Td>{c.city ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{c.phone ?? "—"}</Td>
                  <Td>{c.representant_name ?? "—"}</Td>
                  <Td align="center">
                    <span title={`${c.active_contact_count} actif${c.active_contact_count > 1 ? "s" : ""}`}>
                      <Badge tone={c.contact_count > 0 ? "success" : "warning"}>{c.contact_count}</Badge>
                    </span>
                  </Td>
                  <Td>
                    {c.open_request_count + c.open_odf_count === 0 ? (
                      <span className="text-foreground-muted">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.open_request_count > 0 && (
                          <Badge tone="info">
                            {c.open_request_count} demande{c.open_request_count > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {c.open_odf_count > 0 && <Badge tone="brand">{c.open_odf_count} ODF</Badge>}
                      </div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(c.last_activity_at)}</Td>
                </ClickableTr>
              ))}
              {rows.length === 0 && !list.error && (
                <EmptyRow colSpan={8}>
                  {activeCount > 0
                    ? "Aucun client ne correspond à ces critères. Élargissez la recherche ou réinitialisez les filtres."
                    : "Aucun client pour le moment — lancez la synchronisation Sage."}
                </EmptyRow>
              )}
            </Tbody>
          </Table>
          {totalPages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
              {filters.page > 1 ? (
                <Link href={pageHref(filters.page - 1)} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  <ChevronLeft className="h-4 w-4" /> Précédent
                </Link>
              ) : (
                <span />
              )}
              {filters.page < totalPages ? (
                <Link href={pageHref(filters.page + 1)} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  Suivant <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
