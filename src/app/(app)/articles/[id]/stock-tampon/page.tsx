import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { can } from "@/lib/auth/permissions";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Onglet Stock tampon d'un semi-fini (décisions S25, S37 ; migration 0146) :
 * pièces de ce semi-fini coupées dans les ODF encore ouverts, figées à la
 * clôture de chaque matelas (pièces reconnues sur le tracé × couches
 * réelles). Consultation seule, à la coupe : le suivi par atelier, au scan
 * de réception des lots, viendra avec les lots de semi-finis (étape 4).
 * Interne à la production, jamais envoyé à Sage. Les ODF suivent leur
 * propre visibilité (RLS) : seuls ceux que l'utilisateur voit sont comptés.
 */
export default async function ArticleStockTamponPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: rows }, canOdf] = await Promise.all([
    supabase
      .from("pieces_coupees")
      .select("taille,quantite,production_order_id,production_orders(reference,status)")
      .eq("semi_fini_id", id)
      .eq("source", "trace"),
    can("ordres_fabrication", "view"),
  ]);

  // ODF encore ouverts : une ligne par ODF, une colonne par taille du patron.
  const ouverts = (rows ?? []).filter((r) => {
    const po = r.production_orders as unknown as { status: string } | null;
    return po && !["terminee", "annulee"].includes(po.status);
  });
  const tailles: string[] = [];
  const parOdf = new Map<string, { reference: string; parTaille: Record<string, number>; total: number }>();
  for (const r of ouverts) {
    const t = (r.taille as string | null) ?? "—";
    if (!tailles.includes(t)) tailles.push(t);
    const po = r.production_orders as unknown as { reference: string };
    const odf = parOdf.get(r.production_order_id as string) ?? { reference: po.reference, parTaille: {}, total: 0 };
    odf.parTaille[t] = (odf.parTaille[t] ?? 0) + Number(r.quantite);
    odf.total += Number(r.quantite);
    parOdf.set(r.production_order_id as string, odf);
  }
  const lignes = [...parOdf.entries()].sort((a, b) => a[1].reference.localeCompare(b[1].reference, "fr"));
  const totalTaille = (t: string) => lignes.reduce((s, [, o]) => s + (o.parTaille[t] ?? 0), 0);
  const total = lignes.reduce((s, [, o]) => s + o.total, 0);

  return (
    <Card>
      <CardHeader
        title="Stock tampon — pièces coupées en production"
        description="Pièces de ce semi-fini coupées dans les ODF en cours, comptées à la clôture de chaque matelas (pièces reconnues sur le tracé × couches réelles). Suivi à la coupe, en consultation ; interne à la production, jamais envoyé à Sage."
      />
      <CardBody className="p-0">
        <Table>
          <Thead>
            <tr>
              <Th>ODF</Th>
              {tailles.map((t) => (
                <Th key={t} align="right">
                  {t}
                </Th>
              ))}
              <Th align="right">Total</Th>
            </tr>
          </Thead>
          <Tbody>
            {lignes.length === 0 ? (
              <EmptyRow colSpan={tailles.length + 2}>
                Aucune pièce coupée en cours. Elles apparaissent à la clôture d&apos;un matelas dont le tracé contient le patron de ce semi-fini.
              </EmptyRow>
            ) : (
              <>
                {lignes.map(([odfId, o]) => (
                  <Tr key={odfId}>
                    <Td>
                      {canOdf ? (
                        <Link href={`/atelier/production/${odfId}?onglet=production`} className="font-medium text-brand hover:underline">
                          {o.reference}
                        </Link>
                      ) : (
                        <span className="font-medium">{o.reference}</span>
                      )}
                    </Td>
                    {tailles.map((t) => (
                      <Td key={t} align="right">
                        {o.parTaille[t] ? nf.format(o.parTaille[t]) : "—"}
                      </Td>
                    ))}
                    <Td align="right" className="font-semibold">
                      {nf.format(o.total)}
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td className="font-semibold">Total</Td>
                  {tailles.map((t) => (
                    <Td key={t} align="right" className="font-semibold">
                      {nf.format(totalTaille(t))}
                    </Td>
                  ))}
                  <Td align="right" className="font-semibold">
                    {nf.format(total)}
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
