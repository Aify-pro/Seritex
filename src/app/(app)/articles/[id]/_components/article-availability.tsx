import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getArticleAvailability, summarizeArticle, type ArticleAvailability, type AvailabilityRow } from "@/lib/articles/availability";

const kg = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

const SUMMARY: Record<ArticleAvailability, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  disponible: { tone: "success", label: "Disponible" },
  partiel: { tone: "warning", label: "Partiellement disponible" },
  indisponible: { tone: "danger", label: "Indisponible" },
  non_suivi: { tone: "neutral", label: "Disponibilité non suivie" },
};

function Chip({ row }: { row: AvailabilityRow }) {
  const tone =
    row.statut === "disponible"
      ? "border-success/30 bg-success-soft text-success"
      : row.statut === "indisponible"
        ? "border-danger/30 bg-danger-soft text-danger"
        : "border-border bg-surface-muted text-foreground-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {row.color_name}
      <span className="font-normal opacity-80">
        {row.statut === "indisponible" ? "plus de rouleau" : row.rouleaux > 0 ? `${kg(row.kg)} kg` : "—"}
      </span>
    </span>
  );
}

/**
 * Disponibilité d'un produit fini d'après le tissu en stock (onglet Stock) :
 * par grammage, chaque couleur est disponible ou non selon les rouleaux. Ce
 * signalement n'empêche jamais un devis (réapprovisionnement local ou
 * marchandise en route) ; l'e-shop, lui, ne propose que le disponible.
 */
export async function ArticleAvailabilityCard({ productModelId: id }: { productModelId: string }) {
  const rows = await getArticleAvailability([id]);
  const summary = summarizeArticle(rows);
  const byGrammage = new Map<string, AvailabilityRow[]>();
  for (const r of rows) byGrammage.set(r.textile_id, [...(byGrammage.get(r.textile_id) ?? []), r]);

  return (
    <Card>
      <CardHeader
        title="Disponibilité du tissu"
        description="Calculée sur les rouleaux en stock, par grammage et par couleur. Signalement seulement : un devis reste possible (réapprovisionnement local, marchandise en route)."
        action={<Badge tone={SUMMARY[summary].tone}>{SUMMARY[summary].label}</Badge>}
      />
      <CardBody className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-foreground-muted">Aucun tissu ou aucune couleur déclarés sur cet article (onglets Technique et Déclinaisons).</p>
        )}
        {[...byGrammage.values()].map((list) => (
          <div key={list[0].textile_id} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-sm font-medium text-foreground">
              {list[0].grammage != null ? `${list[0].grammage} g/m²` : "Tissu"}
            </span>
            {list.map((r) => (
              <Chip key={r.color_id} row={r} />
            ))}
            {!list[0].suivi && (
              <span className="text-xs text-foreground-muted">
                Suivi désactivé sur ce grammage — à activer dans l&apos;onglet Stock de l&apos;article tissu.
              </span>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
