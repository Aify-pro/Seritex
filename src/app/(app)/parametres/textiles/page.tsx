import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { NewTextileForm } from "./new-textile-form";
import { TextileActiveToggle } from "./textile-active-toggle";
import { TextileArticles } from "./textile-articles";

/**
 * Référentiel des textiles, et leur rattachement au catalogue Sage.
 *
 * Un tissu est référencé par coloris dans Sage — huit couleurs, huit codes
 * articles — alors que le placement n'en voit qu'un seul textile. Le
 * regroupement est une connaissance métier qu'aucune synchronisation ne peut
 * déduire : elle signale les articles `tissu` orphelins, c'est tout.
 */
export default async function TextilesPage() {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const [{ data: textiles }, { data: liens }, { data: articles }, { data: colors }, { data: models }] =
    await Promise.all([
      supabase.from("textiles").select("*").order("nom"),
      supabase.from("textile_sage_articles").select("textile_id,sage_reference,color_id,colors(name)"),
      supabase.from("stock_item_view").select("sage_reference,designation").eq("category", "tissu").order("designation"),
      supabase.from("colors").select("id,name").eq("active", true).order("name"),
      supabase.from("product_models").select("id,name,textile_id").eq("active", true).order("name"),
    ]);

  const rattachees = new Set((liens ?? []).map((l) => l.sage_reference as string));
  const orphelins = (articles ?? []).filter((a) => !rattachees.has(a.sage_reference));
  const designationDe = new Map((articles ?? []).map((a) => [a.sage_reference, a.designation]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Textiles"
        description="Le tissu tel que le voit la production, pas la comptabilité : un jersey décliné en huit coloris, ce sont huit articles Sage et un seul textile. C'est ce regroupement qui décide du découpage des ordres de tracé — mêler deux textiles dans un même tracé de coupe n'aurait aucun sens."
      />

      <NewTextileForm />

      {orphelins.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{orphelins.length} article(s) tissu</strong> du stock Sage ne sont rattachés à aucun textile. Tant
            qu&apos;ils le restent, les modèles qui les consomment ne pourront pas être regroupés dans un ordre de
            tracé.
          </span>
        </div>
      )}

      <div className="space-y-4">
        {textiles?.map((t) => {
          const liensTextile = (liens ?? [])
            .filter((l) => l.textile_id === t.id)
            .map((l) => ({
              sage_reference: l.sage_reference as string,
              designation: designationDe.get(l.sage_reference as string) ?? "Article absent du miroir Sage",
              colorName: (l.colors as unknown as { name: string } | null)?.name ?? null,
            }));
          const modelesConcernes = (models ?? []).filter((m) => m.textile_id === t.id);

          return (
            <Card key={t.id}>
              <CardHeader
                title={t.nom}
                description={
                  [t.composition, t.grammage ? `${t.grammage} g/m²` : null, t.laize_cm ? `laize ${t.laize_cm} cm` : null]
                    .filter(Boolean)
                    .join(" · ") || "Caractéristiques non renseignées"
                }
                action={<TextileActiveToggle textileId={t.id} active={t.active} />}
              />
              <CardBody className="space-y-3">
                <TextileArticles
                  textileId={t.id}
                  attached={liensTextile}
                  candidates={orphelins}
                  colors={colors ?? []}
                />
                <p className="text-xs text-foreground-muted">
                  {modelesConcernes.length === 0
                    ? "Aucun modèle de produit ne déclare ce textile."
                    : `Modèles : ${modelesConcernes.map((m) => m.name).join(", ")}`}
                </p>
              </CardBody>
            </Card>
          );
        })}
        {(!textiles || textiles.length === 0) && (
          <p className="text-sm text-foreground-muted">
            Aucun textile pour le moment. Créez-en un, puis rattachez-lui les articles Sage qui en sont les coloris.
          </p>
        )}
      </div>
    </div>
  );
}
