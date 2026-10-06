import Link from "next/link";
import { requireArticles } from "@/lib/articles/access";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Table, Thead, Tbody, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Package, Plus, Shirt, Spool } from "lucide-react";
import { applyArticleFilters, articleFiltersToSearchParams, paginate, parseArticleFilters, type ArticleFilters } from "@/lib/articles/filters";
import { loadArticleCatalog } from "@/lib/articles/catalog";
import { NATURE_LABELS, TYPE_APPRO_LABELS, UNITE_LABELS, type Unite } from "@/lib/articles/natures";
import { ArticlesFilters } from "./articles-filters";

const nf = new Intl.NumberFormat("fr-FR");

const NATURE_ICON = { pf: Shirt, mp: Spool, consommable: Package } as const;

/**
 * Module Articles : une seule liste pour tous les articles — produits finis,
 * matières premières, consommables (migration 0093) — car tout peut être
 * vendu. Familles et sous-familles, nature et type d'approvisionnement en
 * filtres ; recherche sans accents, tri et pagination, état dans l'URL.
 * La création ouvre la fiche complète (/articles/nouveau).
 */
export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { canModify, canSeeCosts } = await requireArticles();
  const filters = parseArticleFilters(await searchParams);
  const catalog = await loadArticleCatalog({ canSeeCosts });
  const filtered = applyArticleFilters(catalog.rows, filters);
  const { rows, page, totalPages } = paginate(filtered, filters.page, filters.taille);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Articles"
        description="Produits finis, matières premières et consommables : une fiche par article, tout peut être vendu."
        action={
          canModify ? (
            <div className="flex items-center gap-2">
              <Link href="/articles/regroupement-tissus" className="text-sm font-medium text-brand hover:underline">
                Regrouper les tissus
              </Link>
              <Link
                href="/articles/nouveau"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90"
              >
                <Plus className="h-4 w-4" /> Nouvel article
              </Link>
            </div>
          ) : undefined
        }
      />

      <ArticlesFilters values={filters} options={catalog.options} showGrille={canSeeCosts} />

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-12"> </Th>
              <Th>Code</Th>
              <Th>Nom</Th>
              <Th>Nature</Th>
              <Th>Famille</Th>
              <Th align="right">Déclinaisons</Th>
              <Th align="right">Stock disponible</Th>
              <Th align="right">Prix à partir de</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>Aucun article ne correspond.</EmptyRow>}
            {rows.map((r) => {
              const Icon = NATURE_ICON[r.nature] ?? Package;
              return (
                <ClickableTr key={r.id} href={`/articles/${r.id}/general`}>
                  <Td>
                    {r.vignetteUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.vignetteUrl} alt="" className="h-9 w-9 rounded object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded bg-surface-muted text-foreground-muted">
                        <Icon className="h-4 w-4" />
                      </span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{r.code ?? "—"}</Td>
                  <Td>
                    <span className="font-medium">{r.name}</span>
                    {!r.active && (
                      <Badge tone="neutral" className="ml-2">
                        Inactif
                      </Badge>
                    )}
                    <p className="text-xs text-foreground-muted">
                      {[r.category, r.matiere, r.grammages.length ? r.grammages.map((g) => `${g} g/m²`).join(", ") : null].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm">{NATURE_LABELS[r.nature]}</p>
                    <p className="text-xs text-foreground-muted">
                      {TYPE_APPRO_LABELS[r.typeAppro]} · {UNITE_LABELS[r.unite as Unite] ?? r.unite}
                    </p>
                  </Td>
                  <Td>{r.famille ?? <span className="text-foreground-muted">—</span>}</Td>
                  <Td align="right">{r.declinaisons || "—"}</Td>
                  <Td align="right">{r.stockDisponible === null ? "—" : nf.format(r.stockDisponible)}</Td>
                  <Td align="right">{r.prixAPartirDe === null ? "—" : formatAmount(r.prixAPartirDe)}</Td>
                </ClickableTr>
              );
            })}
          </Tbody>
        </Table>
      </Card>
      <Pagination filters={filters} page={page} totalPages={totalPages} total={filtered.length} />
    </div>
  );
}

function Pagination({ filters, page, totalPages, total }: { filters: ArticleFilters; page: number; totalPages: number; total: number }) {
  const href = (p: number) => {
    const qs = articleFiltersToSearchParams(filters, { page: p }).toString();
    return qs ? `/articles?${qs}` : "/articles";
  };
  return (
    <div className="flex items-center justify-between text-xs text-foreground-muted">
      <span>
        {nf.format(total)} article{total > 1 ? "s" : ""} · page {page}/{totalPages}
      </span>
      <div className="flex gap-1">
        {page > 1 && (
          <Link href={href(page - 1)} className="inline-flex items-center rounded-md border border-border px-2 py-1 hover:bg-surface-muted">
            <ChevronLeft className="h-3.5 w-3.5" /> Précédente
          </Link>
        )}
        {page < totalPages && (
          <Link href={href(page + 1)} className="inline-flex items-center rounded-md border border-border px-2 py-1 hover:bg-surface-muted">
            Suivante <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
