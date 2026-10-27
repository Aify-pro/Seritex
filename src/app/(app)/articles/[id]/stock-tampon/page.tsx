import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { can } from "@/lib/auth/permissions";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

type Row = { production_order_id: string; odf: string; line_id: string; article: string; taille: string; coupees: number; assemblees: number; en_attente: number };

/**
 * Onglet Stock tampon d'un semi-fini (décisions S25, S37, S42 ; migrations
 * 0146, 0150) : pièces de ce semi-fini coupées dans les ODF encore ouverts,
 * déjà assemblées en t-shirts complets, et en attente d'assemblage (pièces
 * coupées par ordres regroupés dont l'article attend encore d'autres pièces).
 * Consultation seule ; le suivi par atelier au scan de réception viendra avec
 * les lots de semi-finis (étape 4). Interne à la production, jamais envoyé à
 * Sage.
 */
export default async function ArticleStockTamponPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, canOdf] = await Promise.all([
    supabase.rpc("stock_tampon_semi_fini", { p_semi_fini_id: id }),
    can("ordres_fabrication", "view"),
  ]);
  const rows = (data ?? []) as Row[];
  const total = (k: "coupees" | "assemblees" | "en_attente") => rows.reduce((s, r) => s + Number(r[k]), 0);

  return (
    <Card>
      <CardHeader
        title="Stock tampon — pièces coupées en production"
        description="Par ODF ouvert et par taille : pièces coupées (matelas clôturés), déjà assemblées en t-shirts complets, et en attente d'assemblage. Consultation ; interne à la production, jamais envoyé à Sage."
      />
      <CardBody className="p-0">
        <Table>
          <Thead>
            <tr>
              <Th>ODF</Th>
              <Th>Article</Th>
              <Th>Taille</Th>
              <Th align="right">Coupées</Th>
              <Th align="right">Assemblées</Th>
              <Th align="right">En attente</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>
                Aucune pièce coupée en cours. Elles apparaissent à la clôture d&apos;un matelas dont le tracé contient le patron de ce semi-fini.
              </EmptyRow>
            ) : (
              <>
                {rows.map((r) => (
                  <Tr key={`${r.line_id}-${r.taille}`}>
                    <Td>
                      {canOdf ? (
                        <Link href={`/atelier/production/${r.production_order_id}?onglet=production`} className="font-medium text-brand hover:underline">
                          {r.odf}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.odf}</span>
                      )}
                    </Td>
                    <Td>{r.article}</Td>
                    <Td>{r.taille.split("/").pop()}</Td>
                    <Td align="right">{nf.format(r.coupees)}</Td>
                    <Td align="right">{nf.format(r.assemblees)}</Td>
                    <Td align="right" className={r.en_attente > 0 ? "font-semibold text-warning" : ""}>
                      {nf.format(r.en_attente)}
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td className="font-semibold">Total</Td>
                  <Td />
                  <Td />
                  <Td align="right" className="font-semibold">
                    {nf.format(total("coupees"))}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {nf.format(total("assemblees"))}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {nf.format(total("en_attente"))}
                  </Td>
                </Tr>
              </>
            )}
          </Tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
