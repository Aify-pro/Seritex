import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { getSizes } from "@/lib/sizes";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

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
  await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data, error }, sizes] = await Promise.all([supabase.rpc("variant_stock_overview", { p_model_id: id }), getSizes()]);
  const all = (data ?? []) as StockRow[];
  // Les articles sans aucun mouvement ni stock encombrent la grille : on ne garde que ceux qui ont un chiffre.
  const rows = all.filter((r) => Number(r.en_stock) !== 0 || r.reserve > 0 || r.en_cours_production > 0 || r.etat === "vierge");
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle;
  const total = (k: "en_stock" | "reserve" | "en_cours_production" | "disponible") => rows.reduce((s, r) => s + Number(r[k]), 0);

  return (
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
  );
}
