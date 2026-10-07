import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { getSizes } from "@/lib/sizes";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArticleRolls } from "../_components/article-rolls";
import { ArticleAvailabilityCard } from "../_components/article-availability";
import { TextileAvailabilityPanel } from "../_components/textile-availability-panel";

interface StockRow {
  variant_id: string;
  stock_article_id: string;
  code: string;
  etat: "vierge" | "personnalise" | "deuxieme_choix";
  sage_reference: string | null;
  textile_nom: string;
  couleur: string;
  taille: string;
  en_stock: number;
  reserve: number;
  en_cours_production: number;
  disponible: number;
}

const ETAT_LABELS: Record<StockRow["etat"], string> = {
  vierge: "Vierge",
  personnalise: "Personnalisé",
  deuxieme_choix: "2e choix",
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Onglet Stock (ART-E) : par article stockable de chaque déclinaison, stock du
 * miroir Sage (tous dépôts), réservé par les ODF validés, en cours de
 * production dans les ODF ouverts et disponible (stock − réservé). Lecture
 * seule : les mouvements se font en atelier et l'import dans Sage.
 */
export default async function ArticleStockPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const { data: article } = await supabase.from("product_models").select("nature").eq("id", id).maybeSingle();
  if (article && article.nature !== "pf") return <PurchasedArticleStock id={id} nature={article.nature as "mp" | "consommable"} canModify={canModify} />;
  const [{ data, error }, sizes] = await Promise.all([supabase.rpc("variant_stock_overview", { p_model_id: id }), getSizes()]);
  const all = (data ?? []) as StockRow[];
  // Les articles sans aucun mouvement ni stock encombrent la grille : on ne garde que ceux qui ont un chiffre.
  const rows = all.filter((r) => Number(r.en_stock) !== 0 || r.reserve > 0 || r.en_cours_production > 0 || r.etat === "vierge");
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle;
  const total = (k: "en_stock" | "reserve" | "en_cours_production" | "disponible") => rows.reduce((s, r) => s + Number(r[k]), 0);

  return (
    <div className="space-y-6">
    <ArticleAvailabilityCard productModelId={id} />
    <Card>
      <CardHeader
        title="Stock par déclinaison"
        description="Stock Sage (tous dépôts, à la dernière synchronisation), réservé par les ODF validés, en cours de production et disponible. Les articles personnalisés et 2e choix n'apparaissent que s'ils ont un chiffre."
      />
      <CardBody className="p-0">
        {error ? (
          <p className="px-5 py-6 text-sm text-danger">Stock indisponible : {error.message}</p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Article</Th>
                <Th>Grammage</Th>
                <Th>Couleur</Th>
                <Th>Taille</Th>
                <Th>État</Th>
                <Th align="right">En stock</Th>
                <Th align="right">Réservé</Th>
                <Th align="right">En production</Th>
                <Th align="right">Disponible</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.stock_article_id}>
                  <Td>
                    <span className="font-mono text-xs">{r.code}</span>
                    {r.sage_reference && r.sage_reference !== r.code && (
                      <span className="ml-2 font-mono text-xs text-foreground-muted">Sage {r.sage_reference}</span>
                    )}
                  </Td>
                  <Td>{r.textile_nom}</Td>
                  <Td>{r.couleur}</Td>
                  <Td>{libelle(r.taille)}</Td>
                  <Td>
                    <Badge tone={r.etat === "vierge" ? "neutral" : r.etat === "personnalise" ? "info" : "warning"}>{ETAT_LABELS[r.etat]}</Badge>
                  </Td>
                  <Td align="right">{nf.format(Number(r.en_stock))}</Td>
                  <Td align="right">{r.reserve ? nf.format(r.reserve) : "—"}</Td>
                  <Td align="right">{r.en_cours_production ? nf.format(r.en_cours_production) : "—"}</Td>
                  <Td align="right" className={Number(r.disponible) < 0 ? "font-medium text-danger" : "font-medium"}>
                    {nf.format(Number(r.disponible))}
                  </Td>
                </Tr>
              ))}
              {rows.length > 0 && (
                <Tr>
                  <Td className="font-medium">Total</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right" className="font-medium">{nf.format(total("en_stock"))}</Td>
                  <Td align="right" className="font-medium">{nf.format(total("reserve"))}</Td>
                  <Td align="right" className="font-medium">{nf.format(total("en_cours_production"))}</Td>
                  <Td align="right" className="font-medium">{nf.format(total("disponible"))}</Td>
                </Tr>
              )}
              {rows.length === 0 && <EmptyRow colSpan={9}>Aucune déclinaison générée pour ce modèle (onglet Déclinaisons).</EmptyRow>}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
    </div>
  );
}

interface VariantStockRow {
  variant_id: string;
  code: string;
  libelle: string;
  sage_reference: string | null;
  en_stock: number;
  rouleaux_stock: number;
  rouleaux_kg: number;
  rouleaux_production: number;
}

/**
 * Stock d'un tissu ou d'un consommable (migration 0105) : par déclinaison, le
 * stock Sage et, pour un tissu, les rouleaux sérialisés (en stock, en kg, en
 * production) ; puis le détail des rouleaux par coloris et par bain.
 */
async function PurchasedArticleStock({ id, nature, canModify }: { id: string; nature: "mp" | "consommable"; canModify: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("article_variant_stock", { p_model_id: id });
  const rows = (data ?? []) as VariantStockRow[];
  const kg = (v: number) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const colSpan = nature === "mp" ? 6 : 3;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Stock par déclinaison"
          description={
            nature === "mp"
              ? "Stock Sage (tous dépôts, à la dernière synchronisation) et rouleaux sérialisés de chaque déclinaison."
              : "Stock Sage (tous dépôts, à la dernière synchronisation) de chaque déclinaison."
          }
        />
        <CardBody className="p-0">
          {error ? (
            <p className="px-5 py-6 text-sm text-danger">Stock indisponible : {error.message}</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Déclinaison</Th>
                  <Th>Libellé</Th>
                  <Th align="right">Stock Sage</Th>
                  {nature === "mp" && (
                    <>
                      <Th align="right">Rouleaux en stock</Th>
                      <Th align="right">Kg en rouleaux</Th>
                      <Th align="right">Rouleaux en production</Th>
                    </>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((r) => (
                  <Tr key={r.variant_id}>
                    <Td>
                      <span className="font-mono text-xs">{r.code}</span>
                      {r.sage_reference && r.sage_reference !== r.code && (
                        <span className="ml-2 font-mono text-xs text-foreground-muted">Sage {r.sage_reference}</span>
                      )}
                    </Td>
                    <Td>{r.libelle}</Td>
                    <Td align="right">{nf.format(Number(r.en_stock))}</Td>
                    {nature === "mp" && (
                      <>
                        <Td align="right">{r.rouleaux_stock ? nf.format(r.rouleaux_stock) : "—"}</Td>
                        <Td align="right">{Number(r.rouleaux_kg) ? kg(r.rouleaux_kg) : "—"}</Td>
                        <Td align="right">{r.rouleaux_production ? nf.format(r.rouleaux_production) : "—"}</Td>
                      </>
                    )}
                  </Tr>
                ))}
                {rows.length === 0 && <EmptyRow colSpan={colSpan}>Aucune déclinaison active (onglet Déclinaisons).</EmptyRow>}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      {nature === "mp" && <TextileAvailabilityPanel productModelId={id} canModify={canModify} />}
      {nature === "mp" && <ArticleRolls productModelId={id} />}
    </div>
  );
}
