import Link from "next/link";
import { ArticleVariantPrices } from "../_components/article-variant-prices";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { getSizes } from "@/lib/sizes";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate } from "@/lib/utils";
import { odfClientLabel } from "@/lib/production/client-label";
import { PRODUCTION_ORDER_STATUS_LABELS, QUOTE_STATUS_LABELS, type ProductionOrderStatus, type QuoteStatus } from "@/lib/types/domain";

interface SalePriceRow {
  textile_id: string | null;
  textile_nom: string | null;
  grammage: number | null;
  taille: string;
  prix_vente: number | null;
  source: "force" | "calcule" | null;
  manquant: string | null;
}

/**
 * Onglet Ventes (ART-D, A2/A6) : prix de vente par grammage et par taille,
 * prix mémorisés par client, historique des devis et des ODF du modèle. Les
 * prix viennent de model_sale_prices() (migration 0083) qui ne renvoie aucun
 * coût : l'onglet est ouvert aux commerciaux.
 */
export default async function ArticleSalesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  // Tissu ou consommable : prix par déclinaison, calculés ou saisis (migration 0104).
  const { data: article } = await supabase.from("product_models").select("nature").eq("id", id).maybeSingle();
  if (article && article.nature !== "pf") return <ArticleVariantPrices productModelId={id} />;

  const [{ data: prices, error: pricesError }, { data: memorized }, { data: quoteLines }, { data: odfLines }, sizes] = await Promise.all([
    supabase.rpc("model_sale_prices", { p_model_id: id }),
    supabase
      .from("client_model_prices")
      .select("company_id,taille,prix_xof,print_signature,updated_at,companies(name),textiles(nom),quotes(reference)")
      .eq("product_model_id", id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("quote_lines")
      .select("id,quantity,unit_price,textiles(nom),quotes!inner(id,reference,status,created_at,devise,companies(name))")
      .eq("product_model_id", id)
      .order("created_at", { ascending: false, referencedTable: "quotes" })
      .limit(50),
    supabase
      .from("production_order_lines")
      .select("id,quantity,textiles(nom),production_orders!inner(id,reference,status,created_at,company_id,companies(name))")
      .eq("product_model_id", id)
      .limit(50),
    getSizes(),
  ]);

  const rows = (prices ?? []) as SalePriceRow[];
  const tailles = [...new Set(rows.map((r) => r.taille))];
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle;
  const grammages = [...new Map(rows.map((r) => [r.textile_id ?? "", { id: r.textile_id, nom: r.textile_nom, grammage: r.grammage }])).values()];
  const missing = [...new Set(rows.map((r) => r.manquant).filter((m): m is string => !!m))];

  type QuoteRef = { id: string; reference: string; status: QuoteStatus; created_at: string; devise: string | null; companies: { name: string } | null };
  type OdfRef = { id: string; reference: string; status: ProductionOrderStatus; created_at: string; company_id: string | null; companies: { name: string } | null };
  const odfs = (odfLines ?? [])
    .map((l) => ({ ...l, po: l.production_orders as unknown as OdfRef }))
    .sort((a, b) => b.po.created_at.localeCompare(a.po.created_at));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Prix de vente par grammage et par taille"
          description="Prix proposés au devis (hors impression), en F CFA HT : prix imposé par la Direction, sinon prix de revient × coefficient, arrondi."
        />
        <CardBody className="p-0">
          {pricesError ? (
            <p className="px-5 py-6 text-sm text-danger">Prix indisponibles : {pricesError.message}</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Grammage</Th>
                  {tailles.map((t) => (
                    <Th key={t} align="right">
                      {libelle(t)}
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {grammages.map((g) => (
                  <Tr key={g.id ?? "aucun"}>
                    <Td>{g.nom ? `${g.nom}${g.grammage ? ` (${g.grammage} g/m²)` : ""}` : "Aucun textile choisi"}</Td>
                    {tailles.map((t) => {
                      const r = rows.find((x) => (x.textile_id ?? "") === (g.id ?? "") && x.taille === t);
                      return (
                        <Td key={t} align="right">
                          {r?.prix_vente != null ? (
                            <span className="inline-flex items-center gap-1">
                              {formatAmount(Number(r.prix_vente))}
                              {r.source === "force" && <Badge tone="info">imposé</Badge>}
                            </span>
                          ) : (
                            <span className="text-foreground-muted">—</span>
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
                {grammages.length === 0 && <EmptyRow colSpan={1 + tailles.length}>Aucune taille déclarée pour ce modèle.</EmptyRow>}
              </Tbody>
            </Table>
          )}
          {missing.length > 0 && (
            <p className="border-t border-border px-5 py-3 text-xs text-warning">
              Prix incomplets : {missing.join(" ; ")}. À compléter par la Direction (onglet Prix de revient).
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Prix mémorisés par client" description="Dernier prix accordé à chaque client, repris en priorité au prochain devis (même configuration d'impression)." />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Client</Th>
                <Th>Taille</Th>
                <Th>Impression</Th>
                <Th>Grammage</Th>
                <Th align="right">Prix</Th>
                <Th>Devis</Th>
                <Th>Le</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(memorized ?? []).map((m) => (
                <Tr key={`${m.company_id}-${m.taille}-${m.print_signature}`}>
                  <Td>{(m.companies as unknown as { name: string } | null)?.name ?? "—"}</Td>
                  <Td>{libelle(m.taille as string)}</Td>
                  <Td>{m.print_signature ? "Imprimé" : "Vierge"}</Td>
                  <Td>{(m.textiles as unknown as { nom: string } | null)?.nom ?? "—"}</Td>
                  <Td align="right">{formatAmount(Number(m.prix_xof))}</Td>
                  <Td className="font-mono text-xs">{(m.quotes as unknown as { reference: string } | null)?.reference ?? "—"}</Td>
                  <Td>{formatDate(m.updated_at as string)}</Td>
                </Tr>
              ))}
              {(!memorized || memorized.length === 0) && <EmptyRow colSpan={7}>Aucun prix mémorisé pour ce modèle.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Devis" description="50 dernières lignes de devis de ce modèle." />
          <CardBody className="p-0">
            <Table>
              <Thead>
                <Tr>
                  <Th>Devis</Th>
                  <Th>Client</Th>
                  <Th>Grammage</Th>
                  <Th align="right">Qté</Th>
                  <Th align="right">Prix unitaire</Th>
                  <Th>Statut</Th>
                </Tr>
              </Thead>
              <Tbody>
                {(quoteLines ?? []).map((l) => {
                  const qt = l.quotes as unknown as QuoteRef;
                  return (
                    <Tr key={l.id}>
                      <Td className="font-mono text-xs">{qt.reference}</Td>
                      <Td>{qt.companies?.name ?? "—"}</Td>
                      <Td>{(l.textiles as unknown as { nom: string } | null)?.nom ?? "—"}</Td>
                      <Td align="right">{l.quantity}</Td>
                      <Td align="right">{formatAmount(Number(l.unit_price), qt.devise ?? "XOF")}</Td>
                      <Td>{QUOTE_STATUS_LABELS[qt.status] ?? qt.status}</Td>
                    </Tr>
                  );
                })}
                {(!quoteLines || quoteLines.length === 0) && <EmptyRow colSpan={6}>Aucun devis pour ce modèle.</EmptyRow>}
              </Tbody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ordres de fabrication" description="50 dernières lignes d'ODF de ce modèle." />
          <CardBody className="p-0">
            <Table>
              <Thead>
                <Tr>
                  <Th>ODF</Th>
                  <Th>Client</Th>
                  <Th>Grammage</Th>
                  <Th align="right">Qté</Th>
                  <Th>Statut</Th>
                </Tr>
              </Thead>
              <Tbody>
                {odfs.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <Link href={`/atelier/production/${l.po.id}`} className="font-mono text-xs font-medium text-brand hover:underline">
                        {l.po.reference}
                      </Link>
                    </Td>
                    <Td>{odfClientLabel(l.po.company_id, l.po.companies?.name) ?? "—"}</Td>
                    <Td>{(l.textiles as unknown as { nom: string } | null)?.nom ?? "—"}</Td>
                    <Td align="right">{l.quantity}</Td>
                    <Td>{PRODUCTION_ORDER_STATUS_LABELS[l.po.status] ?? l.po.status}</Td>
                  </Tr>
                ))}
                {odfs.length === 0 && <EmptyRow colSpan={5}>Aucun ODF pour ce modèle.</EmptyRow>}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
