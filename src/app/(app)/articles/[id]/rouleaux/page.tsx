import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";

const kg = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/**
 * Onglet Rouleaux d'un tissu (migration 0096) : stock par coloris et par bain
 * (la laize et le poids sont ceux des rouleaux), et grammage réel mesuré sur
 * les rouleaux revenus de la coupe — le grammage de l'article n'est que
 * nominal (un 180 g peut faire 175 ou 185).
 */
export default async function ArticleRollsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  // Un tissu peut avoir plusieurs grammages (migration 0102).
  const { data: grammages } = await supabase.from("textiles").select("id,grammage").eq("product_model_id", id).order("grammage");
  const textile = grammages?.[0];
  if (!textile) {
    return (
      <Card>
        <CardBody className="text-sm text-foreground-muted">Aucun tissu relié à cet article.</CardBody>
      </Card>
    );
  }
  const { data: rolls } = await supabase
    .from("textile_rolls")
    .select("code,statut,bain,laize_cm,poids_kg,sage_reference,colors(name)")
    .in("textile_id", (grammages ?? []).map((g) => g.id as string))
    .order("recu_le", { ascending: false })
    .limit(1000);
  const all = rolls ?? [];
  const actifs = all.filter((r) => r.statut === "en_stock" || r.statut === "en_production");

  // Stock par coloris × bain.
  const groupes = new Map<string, { coloris: string; bain: string; enStock: number; kgStock: number; enProduction: number; laizes: number[] }>();
  for (const r of actifs) {
    const coloris = [r.sage_reference, (r.colors as unknown as { name: string } | null)?.name].filter(Boolean).join(" · ") || "Sans coloris";
    const bain = (r.bain as string | null) ?? "—";
    const key = `${coloris}|${bain}`;
    const g = groupes.get(key) ?? { coloris, bain, enStock: 0, kgStock: 0, enProduction: 0, laizes: [] };
    if (r.statut === "en_stock") {
      g.enStock += 1;
      g.kgStock += Number(r.poids_kg);
    } else g.enProduction += 1;
    if (r.laize_cm != null) g.laizes.push(Number(r.laize_cm));
    groupes.set(key, g);
  }

  // Grammage réel des rouleaux revenus de la coupe (20 derniers).
  const revenus = all.filter((r) => r.statut === "en_stock" || r.statut === "epuise").slice(0, 20);
  const bilans = (
    await Promise.all(revenus.map(async (r) => (await supabase.rpc("roll_summary", { p_code: r.code })).data as { code: string; consomme_kg: number; grammage_reel: number | null } | null))
  ).filter((b): b is { code: string; consomme_kg: number; grammage_reel: number | null } => !!b && Number(b.consomme_kg) > 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Stock par coloris et par bain"
          description="Deux bains d'un même coloris peuvent avoir une nuance différente : ils ne se mélangent pas dans un ODF sans motif."
          action={
            <Link href={`/atelier/stock?onglet=rouleaux${(grammages ?? []).length === 1 ? `&tissu=${textile.id}` : ""}`} className="text-sm font-medium text-brand hover:underline">
              Gérer les rouleaux →
            </Link>
          }
        />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Coloris</Th>
                <Th>Bain</Th>
                <Th align="right">Rouleaux en stock</Th>
                <Th align="right">Kg en stock</Th>
                <Th align="right">En production</Th>
                <Th align="right">Laizes</Th>
              </Tr>
            </Thead>
            <Tbody>
              {[...groupes.values()].map((g) => (
                <Tr key={`${g.coloris}|${g.bain}`}>
                  <Td>{g.coloris}</Td>
                  <Td>{g.bain}</Td>
                  <Td align="right">{g.enStock}</Td>
                  <Td align="right">{kg(g.kgStock)}</Td>
                  <Td align="right">{g.enProduction || "—"}</Td>
                  <Td align="right">{g.laizes.length ? `${Math.min(...g.laizes)}–${Math.max(...g.laizes)} cm` : "—"}</Td>
                </Tr>
              ))}
              {groupes.size === 0 && <EmptyRow colSpan={6}>Aucun rouleau en stock pour ce tissu.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Grammage réel mesuré"
          description={`Grammage nominal : ${(grammages ?? []).map((g) => `${g.grammage ?? "—"}`).join(" / ")} g/m². Le réel se calcule sur les rouleaux revenus de la coupe : kg consommés ÷ surface des matelas servis.`}
        />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Rouleau</Th>
                <Th align="right">Kg consommés</Th>
                <Th align="right">Grammage réel</Th>
              </Tr>
            </Thead>
            <Tbody>
              {bilans.map((b) => (
                <Tr key={b.code}>
                  <Td className="font-mono text-xs">{b.code}</Td>
                  <Td align="right">{kg(Number(b.consomme_kg))}</Td>
                  <Td align="right">{b.grammage_reel != null ? `${b.grammage_reel} g/m²` : "—"}</Td>
                </Tr>
              ))}
              {bilans.length === 0 && <EmptyRow colSpan={3}>Aucun rouleau revenu de la coupe pour le moment.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
