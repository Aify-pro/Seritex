import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/utils";
import { UNITE_LABELS, type Unite } from "@/lib/articles/natures";

/**
 * Prix de vente des déclinaisons d'un tissu ou d'un consommable (migration
 * 0104) : calculés (achat + frais × coefficient) ou saisis ; aucun coût
 * n'est lu ici, l'onglet est ouvert aux commerciaux.
 */
export async function ArticleVariantPrices({ productModelId }: { productModelId: string }) {
  const supabase = await createClient();
  const [{ data: prices, error }, { data: variants }, { data: model }] = await Promise.all([
    supabase.rpc("article_variant_prices", { p_model_id: productModelId }),
    supabase.from("product_variants").select("id,textiles(grammage),colors(name),article_dimensions(libelle)").eq("model_id", productModelId),
    supabase.from("product_models").select("unite").eq("id", productModelId).maybeSingle(),
  ]);
  const unite = UNITE_LABELS[(model?.unite as Unite) ?? "piece"] ?? "unité";
  const label = (id: string) => {
    const v = (variants ?? []).find((x) => x.id === id);
    if (!v) return "—";
    const g = (v.textiles as unknown as { grammage: number | null } | null)?.grammage;
    return [g ? `${g} g/m²` : null, (v.article_dimensions as unknown as { libelle: string } | null)?.libelle, (v.colors as unknown as { name: string } | null)?.name]
      .filter(Boolean)
      .join(" · ");
  };
  const rows = (prices ?? []) as { variant_id: string; code: string; prix_vente: number | null; source: string | null; manquant: string | null }[];
  const manquants = [...new Set(rows.map((r) => r.manquant).filter((m): m is string => !!m))];

  return (
    <Card>
      <CardHeader title="Prix de vente par déclinaison" description={`Prix HT par ${unite}, en F CFA : saisi, ou calculé depuis le prix d'achat (onglet Prix de revient).`} />
      <CardBody className="p-0">
        {error ? (
          <p className="px-5 py-6 text-sm text-danger">Prix indisponibles : {error.message}</p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Code</Th>
                <Th>Déclinaison</Th>
                <Th align="right">Prix de vente</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.variant_id}>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td>{label(r.variant_id)}</Td>
                  <Td align="right">
                    {r.prix_vente != null ? (
                      <span className="inline-flex items-center gap-1">
                        {formatAmount(Number(r.prix_vente))} / {unite}
                        {r.source === "saisi" && <Badge tone="info">saisi</Badge>}
                      </span>
                    ) : (
                      <span className="text-foreground-muted">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={3}>Aucune déclinaison active : générez-les dans l&apos;onglet Déclinaisons.</EmptyRow>}
            </Tbody>
          </Table>
        )}
        {manquants.length > 0 && (
          <p className="border-t border-border px-5 py-3 text-xs text-warning">Prix incomplets : {manquants.join(" ; ")}. À compléter par la Direction (onglet Prix de revient).</p>
        )}
      </CardBody>
    </Card>
  );
}
