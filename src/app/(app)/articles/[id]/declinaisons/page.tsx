import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { StockEtat } from "@/lib/articles/codification";
import { VariantMatrix, type MatrixVariant } from "../_components/variant-matrix";

/** Onglet Déclinaisons (COM-0) : matrice grammage × couleur × taille, codes, références Sage. */
export default async function ArticleVariantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: allowed }, { data: modelColors }, { data: modelSizes }, { data: variants }] = await Promise.all([
    supabase.from("product_model_textiles").select("textile_id,textiles(id,nom,grammage)").eq("product_model_id", id),
    supabase.from("product_model_colors").select("color_id,colors(id,name,code)").eq("product_model_id", id),
    supabase.from("product_model_sizes").select("size_id,sizes(id,libelle,groupe,display_order)").eq("product_model_id", id),
    supabase
      .from("product_variants")
      .select("id,textile_id,color_id,size_id,code,sage_reference,actif,variant_stock_articles(id,etat,code,sage_reference)")
      .eq("model_id", id),
  ]);

  // Axes : ce qui est déclaré, plus tout axe encore porté par une déclinaison existante.
  const textileMap = new Map<string, { id: string; nom: string; grammage: number | null }>();
  for (const a of allowed ?? []) {
    const t = a.textiles as unknown as { id: string; nom: string; grammage: number | null } | null;
    if (t) textileMap.set(t.id, t);
  }
  const colors = (modelColors ?? [])
    .map((c) => c.colors as unknown as { id: string; name: string; code: string } | null)
    .filter((c): c is { id: string; name: string; code: string } => !!c)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const sizes = (modelSizes ?? [])
    .map((s) => s.sizes as unknown as { id: string; libelle: string; groupe: string; display_order: number } | null)
    .filter((s): s is { id: string; libelle: string; groupe: string; display_order: number } => !!s)
    .sort((a, b) => a.groupe.localeCompare(b.groupe) || a.display_order - b.display_order);

  const rows: MatrixVariant[] = (variants ?? []).map((v) => ({
    id: v.id,
    textileId: v.textile_id,
    colorId: v.color_id,
    sizeId: v.size_id,
    code: v.code,
    sageReference: v.sage_reference,
    actif: v.actif,
    stockArticles: ((v.variant_stock_articles ?? []) as { id: string; etat: StockEtat; code: string; sage_reference: string | null }[]).map(
      (a) => ({ id: a.id, etat: a.etat, code: a.code, sageReference: a.sage_reference })
    ),
  }));
  const actives = rows.filter((r) => r.actif).length;

  return (
    <Card>
      <CardHeader
        title={`Déclinaisons (${actives} active${actives > 1 ? "s" : ""})`}
        description="Modèle × grammage × couleur × taille. Chaque déclinaison a trois articles stockables : vierge, personnalisé (P) et 2e choix (D)."
      />
      <CardBody>
        {textileMap.size === 0 || colors.length === 0 || sizes.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            Déclarez d&apos;abord la catégorie, la matière, les grammages autorisés, les couleurs et les tailles du modèle
            (onglet Général).
          </p>
        ) : (
          <VariantMatrix
            productModelId={id}
            textiles={[...textileMap.values()].sort((a, b) => (a.grammage ?? 0) - (b.grammage ?? 0))}
            colors={colors}
            sizes={sizes}
            variants={rows}
            editable={canModify}
          />
        )}
      </CardBody>
    </Card>
  );
}
