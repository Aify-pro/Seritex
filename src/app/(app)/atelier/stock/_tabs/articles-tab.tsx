import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { NATURE_LABELS, UNITE_LABELS, type ArticleNature, type Unite } from "@/lib/articles/natures";
import { normalizeSearch } from "@/lib/clients/filters";

interface OverviewRow {
  product_model_id: string;
  nature: ArticleNature;
  code: string | null;
  nom: string;
  famille: string | null;
  unite: Unite;
  references_sage: string[];
  en_stock: number;
  reserve: number;
  disponible: number;
  rouleaux_stock: number;
  rouleaux_kg: number;
  rouleaux_production: number;
  textile_id: string | null;
}

const nf = (v: number) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/**
 * Articles en stock (migration 0097) : chaque article — produit fini, matière
 * première, consommable — avec son stock Sage (tous dépôts, à la dernière
 * synchronisation), le réservé par les ODF, le disponible et, pour un tissu,
 * ses rouleaux.
 */
export async function ArticlesTab({ params }: { params: { q?: string; nature?: string; dispo?: string } }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_articles_overview");
  const q = (params.q ?? "").trim();
  const nature = (["pf", "mp", "consommable"] as const).includes(params.nature as ArticleNature) ? (params.nature as ArticleNature) : "";
  const enStockSeulement = params.dispo !== "tous";
  const terms = normalizeSearch(q).split(/\s+/).filter(Boolean);
  const rows = ((data ?? []) as OverviewRow[]).filter((r) => {
    if (nature && r.nature !== nature) return false;
    if (enStockSeulement && Number(r.en_stock) === 0 && r.rouleaux_stock === 0 && r.rouleaux_production === 0) return false;
    if (terms.length) {
      const text = normalizeSearch([r.nom, r.code, r.famille, ...r.references_sage].filter(Boolean).join(" "));
      if (terms.some((t) => !text.includes(t))) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <form action="/atelier/stock" className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-foreground-muted">Rechercher</span>
          <input name="q" defaultValue={q} placeholder="Nom, code, référence Sage, famille…" className="h-9 w-72 rounded-md border border-border bg-surface px-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-foreground-muted">Nature</span>
          <select name="nature" defaultValue={nature} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            <option value="">Toutes</option>
            {(Object.keys(NATURE_LABELS) as ArticleNature[]).map((n) => (
              <option key={n} value={n}>
                {NATURE_LABELS[n]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-foreground-muted">Afficher</span>
          <select name="dispo" defaultValue={enStockSeulement ? "" : "tous"} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            <option value="">Articles en stock</option>
            <option value="tous">Tous les articles</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted">
          Filtrer
        </button>
      </form>

      <Card>
        <CardBody className="p-0">
          {error ? (
            <p className="px-5 py-6 text-sm text-danger">Stock indisponible : {error.message}</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Code</Th>
                  <Th>Article</Th>
                  <Th>Nature</Th>
                  <Th align="right">En stock (Sage)</Th>
                  <Th align="right">Réservé</Th>
                  <Th align="right">Disponible</Th>
                  <Th align="right">Rouleaux</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((r) => {
                  const unite = UNITE_LABELS[r.unite] ?? r.unite;
                  const onglet = r.nature === "mp" ? "rouleaux" : r.nature === "pf" ? "stock" : "general";
                  return (
                    <Tr key={r.product_model_id}>
                      <Td className="font-mono text-xs">{r.code ?? "—"}</Td>
                      <Td>
                        <Link href={`/articles/${r.product_model_id}/${onglet}`} className="font-medium hover:underline">
                          {r.nom}
                        </Link>
                        <p className="text-xs text-foreground-muted">
                          {[r.famille, r.references_sage.length ? `Sage ${r.references_sage.slice(0, 3).join(", ")}${r.references_sage.length > 3 ? "…" : ""}` : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </Td>
                      <Td>{NATURE_LABELS[r.nature]}</Td>
                      <Td align="right">
                        {nf(r.en_stock)} {unite}
                      </Td>
                      <Td align="right">{Number(r.reserve) ? nf(r.reserve) : "—"}</Td>
                      <Td align="right" className={Number(r.disponible) < 0 ? "font-medium text-danger" : "font-medium"}>
                        {nf(r.disponible)} {unite}
                      </Td>
                      <Td align="right">
                        {r.nature === "mp" ? (
                          <Link href={`/atelier/stock?onglet=rouleaux${r.textile_id ? `&tissu=${r.textile_id}` : ""}`} className="hover:underline">
                            {r.rouleaux_stock} · {nf(r.rouleaux_kg)} kg
                            {r.rouleaux_production > 0 && <span className="text-xs text-foreground-muted"> (+{r.rouleaux_production} en coupe)</span>}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </Tr>
                  );
                })}
                {rows.length === 0 && <EmptyRow colSpan={7}>Aucun article ne correspond.</EmptyRow>}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      <p className="text-xs text-foreground-muted">
        Stock Sage : tous dépôts, à la dernière synchronisation. Réservé : produits finis réservés par les ODF validés. Rouleaux : en stock dans Seritex.
      </p>
    </div>
  );
}
