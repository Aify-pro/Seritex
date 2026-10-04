import Link from "next/link";
import { requireArticles } from "@/lib/articles/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { Badge } from "@/components/ui/badge";
import { cn, formatAmount } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Shirt } from "lucide-react";
import {
  applyArticleFilters,
  articleFiltersToSearchParams,
  articleSearchText,
  paginate,
  parseArticleFilters,
  type ArticleFilters,
  type ArticleTab,
} from "@/lib/articles/filters";
import { searchTerms } from "@/lib/clients/filters";
import { loadArticleCatalog } from "@/lib/articles/catalog";
import { ArticlesFilters } from "./articles-filters";
import { NewProductModelForm } from "./new-product-model-form";
import { NewTextileForm } from "./matieres/new-textile-form";
import { ConsumablesTable, type ConsumableRow } from "./consommables/consumables-table";

const TAB_LABELS: Record<ArticleTab, string> = {
  produits: "Produits finis",
  matieres: "Matières premières",
  consommables: "Consommables",
};

const nf = new Intl.NumberFormat("fr-FR");

/**
 * Module Articles (ART-A) : la fiche article quitte Paramètres (A3). Trois
 * natures, comme le stock (D3) : produits finis (modèles), matières premières
 * (textiles), consommables (COM-G). Recherche sans accents, recherche
 * avancée, tri et pagination, état dans l'URL.
 */
export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { canModify, canSeeCosts } = await requireArticles();
  const filters = parseArticleFilters(await searchParams);

  const tabHref = (onglet: ArticleTab) => {
    const qs = articleFiltersToSearchParams({ ...parseArticleFilters({}), onglet }).toString();
    return qs ? `/articles?${qs}` : "/articles";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Articles"
        description="Produits finis, matières premières et consommables : la fiche de chaque article, ses déclinaisons, sa fabrication et ses prix."
      />

      <nav aria-label="Natures d'article" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {(Object.keys(TAB_LABELS) as ArticleTab[]).map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            aria-current={filters.onglet === t ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              filters.onglet === t
                ? "border-brand text-brand"
                : "border-transparent text-foreground-muted hover:border-border hover:text-foreground"
            )}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {filters.onglet === "produits" && <ProduitsFinis filters={filters} canModify={canModify} canSeeCosts={canSeeCosts} />}
      {filters.onglet === "matieres" && <Matieres filters={filters} canModify={canModify} />}
      {filters.onglet === "consommables" && <Consommables filters={filters} canModify={canModify} />}
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

async function ProduitsFinis({ filters, canModify, canSeeCosts }: { filters: ArticleFilters; canModify: boolean; canSeeCosts: boolean }) {
  const catalog = await loadArticleCatalog({ canSeeCosts });
  const filtered = applyArticleFilters(catalog.rows, filters);
  const { rows, page, totalPages } = paginate(filtered, filters.page, filters.taille);

  return (
    <div className="space-y-4">
      <ArticlesFilters values={filters} options={catalog.options} showGrille={canSeeCosts} />
      {canModify && <NewProductModelForm />}
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-12"> </Th>
              <Th>Code</Th>
              <Th>Nom</Th>
              <Th>Catégorie</Th>
              <Th align="right">Déclinaisons</Th>
              <Th align="right">Stock disponible</Th>
              <Th align="right">Prix à partir de</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && <EmptyRow colSpan={7}>Aucun article ne correspond.</EmptyRow>}
            {rows.map((r) => (
              <ClickableTr key={r.id} href={`/articles/${r.id}/general`}>
                <Td>
                  {r.vignetteUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.vignetteUrl} alt="" className="h-9 w-9 rounded object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded bg-surface-muted text-foreground-muted">
                      <Shirt className="h-4 w-4" />
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
                  {r.matiere && <p className="text-xs text-foreground-muted">{r.matiere}</p>}
                </Td>
                <Td>{r.category ?? "—"}</Td>
                <Td align="right">{r.declinaisons || "—"}</Td>
                <Td align="right">{r.stockDisponible === null ? "—" : nf.format(r.stockDisponible)}</Td>
                <Td align="right">{r.prixAPartirDe === null ? "—" : formatAmount(r.prixAPartirDe)}</Td>
              </ClickableTr>
            ))}
          </Tbody>
        </Table>
      </Card>
      <Pagination filters={filters} page={page} totalPages={totalPages} total={filtered.length} />
    </div>
  );
}

async function Matieres({ filters, canModify }: { filters: ArticleFilters; canModify: boolean }) {
  const supabase = await createClient();
  const [{ data: textiles }, { data: liens }, { data: models }] = await Promise.all([
    supabase.from("textiles").select("id,nom,composition,grammage,laize_cm,active").order("nom"),
    supabase.from("textile_sage_articles").select("textile_id"),
    supabase.from("product_models").select("textile_id").eq("active", true),
  ]);
  const terms = searchTerms(filters.q);
  const all = (textiles ?? []).filter((t) => {
    const text = articleSearchText([t.nom as string, t.composition as string | null, t.grammage ? `${t.grammage}` : null]);
    return terms.every((term) => text.includes(term)) && (filters.actif === "tous" || (filters.actif === "oui") === !!t.active);
  });
  const { rows, page, totalPages } = paginate(all, filters.page, filters.taille);

  return (
    <div className="space-y-4">
      <ArticlesFilters
        values={filters}
        options={{ categories: [], matieres: [], grammages: [], couleurs: [] }}
        showGrille={false}
      />
      {canModify && <NewTextileForm />}
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Textile</Th>
              <Th>Composition</Th>
              <Th align="right">Grammage</Th>
              <Th align="right">Laize</Th>
              <Th align="right">Articles Sage</Th>
              <Th align="right">Modèles</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>Aucune matière ne correspond.</EmptyRow>}
            {rows.map((t) => (
              <ClickableTr key={t.id} href={`/articles/matieres/${t.id}`}>
                <Td>
                  <span className="font-medium">{t.nom}</span>
                  {!t.active && (
                    <Badge tone="neutral" className="ml-2">
                      Inactif
                    </Badge>
                  )}
                </Td>
                <Td>{t.composition ?? "—"}</Td>
                <Td align="right">{t.grammage ? `${t.grammage} g/m²` : "—"}</Td>
                <Td align="right">{t.laize_cm ? `${t.laize_cm} cm` : "—"}</Td>
                <Td align="right">{(liens ?? []).filter((l) => l.textile_id === t.id).length}</Td>
                <Td align="right">{(models ?? []).filter((m) => m.textile_id === t.id).length}</Td>
              </ClickableTr>
            ))}
          </Tbody>
        </Table>
      </Card>
      <Pagination filters={filters} page={page} totalPages={totalPages} total={all.length} />
    </div>
  );
}

/** Consommables (COM-G) : boutons, fil, étiquettes, emballages — consommés à la clôture des ODF selon la nomenclature. */
async function Consommables({ filters, canModify }: { filters: ArticleFilters; canModify: boolean }) {
  const supabase = await createClient();
  const [{ data: consumables }, { data: familles }, { data: liens }] = await Promise.all([
    supabase.from("consumables").select("id,code,designation,unite,sage_reference,nature,etape,actif,consumable_families(nom)").order("code"),
    supabase.from("consumable_families").select("id,nom,code_court").order("nom"),
    supabase.from("nomenclature_lines").select("consumable_id,product_model_id").not("consumable_id", "is", null),
  ]);
  const terms = searchTerms(filters.q);
  const all: ConsumableRow[] = (consumables ?? [])
    .map((c) => ({
      id: c.id as string,
      code: c.code as string,
      designation: c.designation as string,
      famille: (c.consumable_families as unknown as { nom: string } | null)?.nom ?? "—",
      unite: c.unite as string,
      sageReference: (c.sage_reference as string | null) ?? null,
      nature: c.nature as "consommable" | "mp",
      etape: c.etape as "production" | "finition",
      actif: !!c.actif,
      modeles: new Set((liens ?? []).filter((l) => l.consumable_id === c.id).map((l) => l.product_model_id)).size,
    }))
    .filter((c) => {
      const text = articleSearchText([c.code, c.designation, c.famille, c.sageReference]);
      return terms.every((term) => text.includes(term)) && (filters.actif === "tous" || (filters.actif === "oui") === c.actif);
    });
  const { rows, page, totalPages } = paginate(all, filters.page, filters.taille);

  return (
    <div className="space-y-4">
      <ArticlesFilters values={filters} options={{ categories: [], matieres: [], grammages: [], couleurs: [] }} showGrille={false} />
      <Card>
        <CardBody>
          <ConsumablesTable
            rows={rows}
            familles={(familles ?? []).map((f) => ({ id: f.id as string, nom: f.nom as string, code: f.code_court as string }))}
            canModify={canModify}
          />
        </CardBody>
      </Card>
      <Pagination filters={filters} page={page} totalPages={totalPages} total={all.length} />
    </div>
  );
}
