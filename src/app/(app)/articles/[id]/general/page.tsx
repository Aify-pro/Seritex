import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { IdentityForm } from "../_components/identity-form";
import { ProductModelActiveToggle } from "../_components/product-model-active-toggle";
import { ProductModelTextile } from "../_components/product-model-textile";
import { ProductModelSageReference } from "../_components/product-model-sage-reference";
import { AvailabilityEditor } from "../_components/availability-editor";
import { ModelClassification } from "../_components/model-classification";
import { ArticleClassementForm } from "../_components/article-classement-form";
import { TextileTechniqueForm } from "../_components/textile-technique-form";
import { ConsumableTechniqueForm } from "../_components/consumable-technique-form";
import { TextileArticles } from "../../matieres/textile-articles";
import Link from "next/link";
import type { ArticleNature, TypeAppro, Unite } from "@/lib/articles/natures";

/**
 * Onglet Général, commun à toutes les natures (migration 0093) : identité et
 * classement, puis ce qui est propre à la nature — pour un produit fini sa
 * codification, son tissu et sa disponibilité ; pour une matière première
 * ses caractéristiques et ses coloris Sage ; pour un consommable son code.
 */
export default async function ArticleGeneralPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: model },
    { data: textiles },
    { data: sizes },
    { data: colors },
    { data: modelSizes },
    { data: modelColors },
    { data: categories },
    { data: matieres },
    { data: allowedTextiles },
  ] = await Promise.all([
      supabase
        .from("product_models")
        .select("id,name,category,active,sage_reference,textile_id,code,categorie_id,matiere_id,nature,type_appro,famille_id,sous_famille_id,unite")
        .eq("id", id)
        .single(),
      supabase.from("textiles").select("id,nom,grammage,matiere_id").eq("active", true).order("nom"),
      supabase.from("sizes").select("id,groupe,libelle").eq("active", true).order("groupe").order("display_order"),
      supabase.from("colors").select("id,name").eq("active", true).order("name"),
      supabase.from("product_model_sizes").select("size_id").eq("product_model_id", id),
      supabase.from("product_model_colors").select("color_id").eq("product_model_id", id),
      supabase.from("product_categories").select("id,nom,code_court").order("nom"),
      supabase.from("matieres").select("id,nom,code_court").eq("actif", true).order("nom"),
      supabase.from("product_model_textiles").select("textile_id").eq("product_model_id", id),
    ]);
  if (!model) return null;
  const nature = model.nature as ArticleNature;
  const { data: familles } = await supabase.from("article_families").select("id,nom,parent_id").eq("actif", true).order("ordre").order("nom");

  const identite = (
    <Card>
      <CardHeader
        title="Identité et classement"
        action={canModify ? <ProductModelActiveToggle productModelId={model.id} active={model.active} /> : undefined}
      />
      <CardBody className="space-y-4">
        <IdentityForm productModelId={model.id} name={model.name} category={model.category} editable={canModify} />
        <ArticleClassementForm
          productModelId={model.id}
          nature={nature}
          initial={{
            type_appro: model.type_appro as TypeAppro,
            famille_id: model.famille_id,
            sous_famille_id: model.sous_famille_id,
            unite: model.unite as Unite,
          }}
          familles={(familles ?? []).map((f) => ({ id: f.id as string, nom: f.nom as string, parentId: (f.parent_id as string | null) ?? null }))}
          editable={canModify}
        />
      </CardBody>
    </Card>
  );

  if (nature === "mp") {
    const [{ data: textile }, { data: liens }, { data: articles }] = await Promise.all([
      supabase.from("textiles").select("id,composition,grammage,matiere_id").eq("product_model_id", id).maybeSingle(),
      supabase.from("textile_sage_articles").select("textile_id,sage_reference,color_id,colors(name)"),
      supabase.from("stock_item_view").select("sage_reference,designation").eq("category", "tissu").order("designation"),
    ]);
    if (!textile) return identite;
    const rattachees = new Set((liens ?? []).map((l) => l.sage_reference as string));
    const designationDe = new Map((articles ?? []).map((a) => [a.sage_reference, a.designation]));
    const attached = (liens ?? [])
      .filter((l) => l.textile_id === textile.id)
      .map((l) => ({
        sage_reference: l.sage_reference as string,
        designation: designationDe.get(l.sage_reference as string) ?? "Article absent du miroir Sage",
        colorName: (l.colors as unknown as { name: string } | null)?.name ?? null,
      }));
    // Le miroir a une ligne par dépôt (migration 0058) : dédoublonnage.
    const orphelins = [...new Map((articles ?? []).filter((a) => !rattachees.has(a.sage_reference)).map((a) => [a.sage_reference, a])).values()];
    const { data: porteurs } = await supabase.from("product_models").select("id,name").eq("textile_id", textile.id).order("name");
    return (
      <div className="space-y-4">
        {identite}
        <Card>
          <CardHeader
            title="Caractéristiques du tissu"
            description="Grammage nominal de l'article ; la laize et le poids réels sont ceux de chaque rouleau, le grammage réel se mesure à la production."
          />
          <CardBody>
            <TextileTechniqueForm textile={textile} matieres={matieres ?? []} editable={canModify} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Coloris Sage" description="Les articles Sage (un par coloris) qui sont ce tissu." />
          <CardBody>
            {canModify ? (
              <TextileArticles textileId={textile.id} attached={attached} candidates={orphelins} colors={colors ?? []} />
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
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Produits finis taillés dans ce tissu" />
          <CardBody>
            {(porteurs ?? []).length === 0 ? (
              <p className="text-sm text-foreground-muted">Aucun produit fini n&apos;a ce tissu comme tissu principal.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {(porteurs ?? []).map((m) => (
                  <li key={m.id}>
                    <Link href={`/articles/${m.id}/general`} className="rounded-md border border-border px-2 py-1 hover:bg-surface-muted">
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  if (nature === "consommable") {
    const { data: consumable } = await supabase
      .from("consumables")
      .select("id,code,etape,sage_reference,consumable_families(nom,code_court)")
      .eq("product_model_id", id)
      .maybeSingle();
    return (
      <div className="space-y-4">
        {identite}
        {consumable && (
          <Card>
            <CardHeader title="Consommable" description="Relié à la nomenclature des produits finis : sa consommation est calculée à la clôture des ODF." />
            <CardBody>
              <ConsumableTechniqueForm
                consumable={{
                  id: consumable.id as string,
                  code: consumable.code as string,
                  famille: (() => {
                    const f = consumable.consumable_families as unknown as { nom: string; code_court: string } | null;
                    return f ? `${f.nom} (CO${f.code_court})` : null;
                  })(),
                  etape: consumable.etape as "production" | "finition",
                  sage_reference: (consumable.sage_reference as string | null) ?? null,
                }}
                editable={canModify}
              />
            </CardBody>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {identite}
      <Card>
        <CardHeader title="Codification et tissu" />
        <CardBody className="space-y-4">
          <ModelClassification
            productModelId={model.id}
            code={model.code}
            categorieId={model.categorie_id}
            matiereId={model.matiere_id}
            categories={categories ?? []}
            matieres={matieres ?? []}
            textiles={textiles ?? []}
            allowedTextileIds={(allowedTextiles ?? []).map((t) => t.textile_id)}
            editable={canModify}
          />
          {canModify ? (
            <ProductModelTextile productModelId={model.id} textileId={model.textile_id} textiles={textiles ?? []} />
          ) : (
            <p className="text-sm">
              <span className="text-foreground-muted">Tissu principal : </span>
              {(textiles ?? []).find((t) => t.id === model.textile_id)?.nom ?? "non déclaré"}
            </p>
          )}
          {canModify && (
            <div className="space-y-1">
              <ProductModelSageReference productModelId={model.id} sageReference={model.sage_reference} />
              <p className="text-[11px] text-foreground-muted">
                Référence au niveau du modèle — obsolète : les références Sage se portent désormais par déclinaison.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Disponibilité"
          description="Tailles et couleurs dans lesquelles le modèle existe. Rien de coché : tout le référentiel actif reste proposable."
        />
        <CardBody>
          {canModify ? (
            <AvailabilityEditor
              productModelId={model.id}
              sizes={(sizes ?? []).map((s) => ({ id: s.id, label: s.libelle, groupe: s.groupe }))}
              colors={(colors ?? []).map((c) => ({ id: c.id, label: c.name }))}
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
    </div>
  );
}
