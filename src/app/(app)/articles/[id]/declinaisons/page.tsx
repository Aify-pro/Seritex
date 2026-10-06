import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { StockEtat } from "@/lib/articles/codification";
import { VariantMatrix, type MatrixVariant } from "../_components/variant-matrix";
import { ArticleVariantGrid } from "../_components/article-variant-grid";
import { ColorAxis, DimensionAxis, GrammageAxis } from "../_components/article-variant-axes";
import { ModelClassification } from "../_components/model-classification";
import { AvailabilityEditor } from "../_components/availability-editor";
import { TextileArticles } from "../../matieres/textile-articles";

/**
 * Onglet Déclinaisons, même disposition pour toutes les natures : Axes de
 * déclinaison, puis la grille des déclinaisons (et, pour un tissu, ses
 * articles Sage par coloris). Produit fini = grammage × couleur × taille
 * (COM-0) ; tissu = grammage × couleur ; consommable = dimension × couleur
 * (migration 0102). Les codes suivent la règle de codification de la nature.
 */
export default async function ArticleVariantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const { data: article } = await supabase.from("product_models").select("nature,code,categorie_id,matiere_id").eq("id", id).maybeSingle();
  if (article && article.nature !== "pf") {
    return <ArticleAxesVariants id={id} nature={article.nature as "mp" | "consommable"} canModify={canModify} />;
  }

  const [
    { data: allowed },
    { data: modelColors },
    { data: modelSizes },
    { data: variants },
    { data: allTextiles },
    { data: allSizes },
    { data: allColors },
  ] = await Promise.all([
    supabase.from("product_model_textiles").select("textile_id,textiles(id,nom,grammage)").eq("product_model_id", id),
    supabase.from("product_model_colors").select("color_id,colors(id,name,code,hex)").eq("product_model_id", id),
    supabase.from("product_model_sizes").select("size_id,sizes(id,libelle,groupe,display_order)").eq("product_model_id", id),
    supabase
      .from("product_variants")
      .select("id,textile_id,color_id,size_id,code,sage_reference,actif,variant_stock_articles(id,etat,code,sage_reference)")
      .eq("model_id", id),
    supabase.from("textiles").select("id,nom,grammage,matiere_id").eq("active", true).order("nom"),
    supabase.from("sizes").select("id,groupe,libelle").eq("active", true).order("groupe").order("display_order"),
    supabase.from("colors").select("id,name").eq("active", true).order("name"),
  ]);

  // Axes : ce qui est déclaré, plus tout axe encore porté par une déclinaison existante.
  const textileMap = new Map<string, { id: string; nom: string; grammage: number | null }>();
  for (const a of allowed ?? []) {
    const t = a.textiles as unknown as {
      id: string;
      nom: string;
      grammage: number | null;
    } | null;
    if (t) textileMap.set(t.id, t);
  }
  const colors = (modelColors ?? [])
    .map(
      (c) =>
        c.colors as unknown as {
          id: string;
          name: string;
          code: string;
        } | null,
    )
    .filter((c): c is { id: string; name: string; code: string } => !!c)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const sizes = (modelSizes ?? [])
    .map(
      (s) =>
        s.sizes as unknown as {
          id: string;
          libelle: string;
          groupe: string;
          display_order: number;
        } | null,
    )
    .filter(
      (
        s,
      ): s is {
        id: string;
        libelle: string;
        groupe: string;
        display_order: number;
      } => !!s,
    )
    .sort((a, b) => a.groupe.localeCompare(b.groupe) || a.display_order - b.display_order);

  const rows: MatrixVariant[] = (variants ?? []).map((v) => ({
    id: v.id,
    textileId: v.textile_id,
    colorId: v.color_id,
    sizeId: v.size_id,
    code: v.code,
    sageReference: v.sage_reference,
    actif: v.actif,
    stockArticles: (
      (v.variant_stock_articles ?? []) as {
        id: string;
        etat: StockEtat;
        code: string;
        sage_reference: string | null;
      }[]
    ).map((a) => ({
      id: a.id,
      etat: a.etat,
      code: a.code,
      sageReference: a.sage_reference,
    })),
  }));
  const actives = rows.filter((r) => r.actif).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Axes de déclinaison"
          description="Grammages, tailles et couleurs dans lesquels le modèle existe — ce qu'il propose au dispatching. Rien de coché en tailles ou couleurs : tout le référentiel actif reste proposable."
        />
        <CardBody className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground-muted">Grammages (textiles de la matière)</p>
            <ModelClassification
              part="grammages"
              productModelId={id}
              code={(article?.code as string | null) ?? null}
              categorieId={(article?.categorie_id as string | null) ?? null}
              matiereId={(article?.matiere_id as string | null) ?? null}
              categories={[]}
              matieres={[]}
              textiles={allTextiles ?? []}
              allowedTextileIds={(allowed ?? []).map((a) => a.textile_id as string)}
              editable={canModify}
            />
          </div>
          {canModify ? (
            <AvailabilityEditor
              productModelId={id}
              sizes={(allSizes ?? []).map((s) => ({
                id: s.id,
                label: s.libelle,
                groupe: s.groupe,
              }))}
              colors={(allColors ?? []).map((c) => ({
                id: c.id,
                label: c.name,
              }))}
              initialSizeIds={(modelSizes ?? []).map((r) => r.size_id)}
              initialColorIds={(modelColors ?? []).map((r) => r.color_id)}
            />
          ) : (
            <p className="text-sm text-foreground-muted">
              {(modelSizes ?? []).length} taille(s) et {(modelColors ?? []).length} couleur(s) déclarées.
            </p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={`Déclinaisons (${actives} active${actives > 1 ? "s" : ""})`}
          description="Modèle × grammage × couleur × taille. Chaque déclinaison a trois articles stockables : vierge, personnalisé (P) et 2e choix (D)."
        />
        <CardBody>
          {textileMap.size === 0 || colors.length === 0 || sizes.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Déclarez d&apos;abord la catégorie et la matière (onglet Général), puis les grammages, les tailles et les couleurs ci-dessus.
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
    </div>
  );
}

/** Déclinaisons d'un tissu ou d'un consommable : axes à déclarer, puis la grille. */
async function ArticleAxesVariants({ id, nature, canModify }: { id: string; nature: "mp" | "consommable"; canModify: boolean }) {
  const supabase = await createClient();
  const [{ data: colors }, { data: modelColors }, { data: textiles }, { data: dimensions }, { data: variants }] = await Promise.all([
    supabase.from("colors").select("id,name,hex,code").eq("active", true).order("name"),
    supabase.from("product_model_colors").select("color_id").eq("product_model_id", id),
    supabase.from("textiles").select("id,grammage,code_court,active").eq("product_model_id", id).order("grammage"),
    supabase.from("article_dimensions").select("id,libelle,code_court,actif,ordre").eq("product_model_id", id).order("ordre"),
    supabase.from("product_variants").select("id,textile_id,color_id,dimension_id,code,sage_reference,actif").eq("model_id", id),
  ]);
  const selectedColors = (modelColors ?? []).map((c) => c.color_id as string);
  const colorName = new Map((colors ?? []).map((c) => [c.id as string, c.name as string]));
  const cols = selectedColors.length
    ? selectedColors.map((c) => ({ key: c, label: colorName.get(c) ?? "Couleur" })).sort((a, b) => a.label.localeCompare(b.label, "fr"))
    : [{ key: "-", label: "Sans couleur" }];
  const rows =
    nature === "mp"
      ? (textiles ?? [])
          .filter((t) => t.active)
          .map((t) => ({
            key: t.id as string,
            label: `${t.grammage ?? "?"} g/m²`,
          }))
      : (dimensions ?? []).filter((d) => d.actif).length
        ? (dimensions ?? []).filter((d) => d.actif).map((d) => ({ key: d.id as string, label: d.libelle as string }))
        : [{ key: "-", label: "Sans dimension" }];
  const grid = (variants ?? []).map((v) => ({
    id: v.id as string,
    rowKey: (nature === "mp" ? (v.textile_id as string | null) : (v.dimension_id as string | null)) ?? "-",
    colKey: (v.color_id as string | null) ?? "-",
    code: v.code as string,
    sageReference: (v.sage_reference as string | null) ?? null,
    actif: !!v.actif,
  }));
  const actives = grid.filter((g) => g.actif).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Axes de déclinaison"
          description={
            nature === "mp"
              ? "Un tissu se décline en grammages et en couleurs (ex. Jersey 180 g blanc → JE180BLA). La laize et le poids sont ceux de chaque rouleau."
              : "Un consommable se décline en dimensions (12 mm, 50 m, S…) et/ou en couleurs."
          }
        />
        <CardBody className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground-muted">{nature === "mp" ? "Grammages" : "Dimensions"}</p>
            {nature === "mp" ? (
              <GrammageAxis
                productModelId={id}
                grammages={(textiles ?? []).map((t) => ({
                  id: t.id as string,
                  grammage: t.grammage != null ? Number(t.grammage) : null,
                  codeCourt: (t.code_court as string | null) ?? null,
                }))}
                editable={canModify}
              />
            ) : (
              <DimensionAxis
                productModelId={id}
                dimensions={(dimensions ?? []).map((d) => ({
                  id: d.id as string,
                  libelle: d.libelle as string,
                  codeCourt: d.code_court as string,
                  actif: !!d.actif,
                }))}
                editable={canModify}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground-muted">Couleurs</p>
            <ColorAxis
              productModelId={id}
              colors={(colors ?? []).map((c) => ({
                id: c.id as string,
                name: c.name as string,
                hex: (c.hex as string | null) ?? null,
                code: (c.code as string | null) ?? null,
              }))}
              selected={selectedColors}
              editable={canModify}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={`Déclinaisons (${actives} active${actives > 1 ? "s" : ""})`}
          description="Codes selon la règle de la nature (Paramètres > Codification). Une déclinaison ne se supprime pas : elle se désactive."
        />
        <CardBody>
          <ArticleVariantGrid
            productModelId={id}
            rows={rows}
            cols={cols}
            rowLabel={nature === "mp" ? "Grammage" : "Dimension"}
            variants={grid}
            editable={canModify}
          />
        </CardBody>
      </Card>
      {nature === "mp" && <TextileSageArticles grammages={textiles ?? []} canModify={canModify} />}
    </div>
  );
}

/** Articles Sage d'un tissu, un par coloris, pour chacun de ses grammages. */
async function TextileSageArticles({ grammages, canModify }: { grammages: { id: string; grammage: number | null }[]; canModify: boolean }) {
  if (grammages.length === 0) return null;
  const supabase = await createClient();
  const [{ data: liens }, { data: articles }, { data: colors }] = await Promise.all([
    supabase.from("textile_sage_articles").select("textile_id,sage_reference,color_id,colors(name)"),
    supabase.from("stock_item_view").select("sage_reference,designation").eq("category", "tissu").order("designation"),
    supabase.from("colors").select("id,name").eq("active", true).order("name"),
  ]);
  const rattachees = new Set((liens ?? []).map((l) => l.sage_reference as string));
  const designationDe = new Map((articles ?? []).map((a) => [a.sage_reference, a.designation]));
  // Le miroir a une ligne par dépôt (migration 0058) : dédoublonnage.
  const orphelins = [...new Map((articles ?? []).filter((a) => !rattachees.has(a.sage_reference)).map((a) => [a.sage_reference, a])).values()];
  const attachedOf = (textileId: string) =>
    (liens ?? [])
      .filter((l) => l.textile_id === textileId)
      .map((l) => ({
        sage_reference: l.sage_reference as string,
        designation: designationDe.get(l.sage_reference as string) ?? "Article absent du miroir Sage",
        colorName: (l.colors as unknown as { name: string } | null)?.name ?? null,
      }));
  return (
    <Card>
      <CardHeader title="Articles Sage par coloris" description="Les articles Sage (un par coloris) de chaque grammage du tissu." />
      <CardBody className="space-y-4">
        {grammages.map((g) => {
          const attached = attachedOf(g.id);
          return (
            <div key={g.id} className="space-y-1.5">
              {grammages.length > 1 && <p className="text-xs font-medium text-foreground-muted">{g.grammage ?? "?"} g/m²</p>}
              {canModify ? (
                <TextileArticles textileId={g.id} attached={attached} candidates={orphelins} colors={colors ?? []} />
              ) : (
                <ul className="space-y-1 text-sm">
                  {attached.map((a) => (
                    <li key={a.sage_reference}>
                      <span className="font-mono text-xs">{a.sage_reference}</span> — {a.designation}
                      {a.colorName ? ` (${a.colorName})` : ""}
                    </li>
                  ))}
                  {attached.length === 0 && <li className="text-foreground-muted">Aucun article Sage rattaché.</li>}
                </ul>
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
