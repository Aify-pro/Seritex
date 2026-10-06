import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { IdentityForm } from "../_components/identity-form";
import { ProductModelActiveToggle } from "../_components/product-model-active-toggle";
import { ProductModelTextile } from "../_components/product-model-textile";
import { ProductModelSageReference } from "../_components/product-model-sage-reference";
import { ModelClassification } from "../_components/model-classification";
import { ArticleClassementForm } from "../_components/article-classement-form";
import { TextileTechniqueForm } from "../_components/textile-technique-form";
import { ConsumableTechniqueForm } from "../_components/consumable-technique-form";
import Link from "next/link";
import type { ArticleNature, TypeAppro, Unite } from "@/lib/articles/natures";

/**
 * Onglet Général : ce qu'est l'article, avec la même disposition pour toutes
 * les natures — Identité et classement, Caractéristiques (codification et
 * tissu d'un produit fini, composition d'un tissu, famille et étape d'un
 * consommable), puis Utilisation (les produits finis qui emploient ce tissu
 * ou ce consommable). Ce qui décline l'article (axes, grille, références
 * Sage) est dans l'onglet Déclinaisons.
 */
export default async function ArticleGeneralPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: model },
    { data: textiles },
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
    // Un tissu peut avoir plusieurs grammages (migration 0102) : une ligne textile par grammage.
    const { data: grammages } = await supabase.from("textiles").select("id,composition,matiere_id").eq("product_model_id", id).order("grammage");
    if (!grammages || grammages.length === 0) return identite;
    const { data: porteurs } = await supabase
      .from("product_models")
      .select("id,name")
      .in("textile_id", grammages.map((g) => g.id as string))
      .order("name");
    return (
      <div className="space-y-4">
        {identite}
        <Card>
          <CardHeader
            title="Caractéristiques"
            description="Communes à tous les grammages du tissu. Les grammages et les couleurs sont ses axes de déclinaison (onglet Déclinaisons) ; la laize et le poids sont ceux de chaque rouleau."
          />
          <CardBody>
            <TextileTechniqueForm
              productModelId={id}
              textile={{ composition: (grammages[0].composition as string | null) ?? null, matiere_id: (grammages[0].matiere_id as string | null) ?? null }}
              matieres={matieres ?? []}
              editable={canModify}
            />
          </CardBody>
        </Card>
        <UsageCard
          title="Utilisation"
          description="Produits finis taillés dans ce tissu (tissu principal)."
          empty="Aucun produit fini n'a ce tissu comme tissu principal."
          models={porteurs ?? []}
        />
      </div>
    );
  }

  if (nature === "consommable") {
    const { data: consumable } = await supabase
      .from("consumables")
      .select("id,code,etape,sage_reference,consumable_families(nom,code_court)")
      .eq("product_model_id", id)
      .maybeSingle();
    const { data: usages } = consumable
      ? await supabase.from("nomenclature_lines").select("product_models(id,name)").eq("consumable_id", consumable.id as string)
      : { data: [] };
    const utilisateurs = [
      ...new Map(
        (usages ?? [])
          .map((u) => u.product_models as unknown as { id: string; name: string } | null)
          .filter((m): m is { id: string; name: string } => !!m)
          .map((m) => [m.id, m])
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return (
      <div className="space-y-4">
        {identite}
        {consumable && (
          <Card>
            <CardHeader title="Caractéristiques" description="Relié à la nomenclature des produits finis : sa consommation est calculée à la clôture des ODF." />
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
        {consumable && (
          <UsageCard
            title="Utilisation"
            description="Produits finis dont la nomenclature contient ce consommable."
            empty="Aucune nomenclature ne contient ce consommable."
            models={utilisateurs}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {identite}
      <Card>
        <CardHeader title="Caractéristiques" description="Codification et tissu principal. Les grammages, tailles et couleurs proposés sont les axes de déclinaison (onglet Déclinaisons)." />
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
            part="codification"
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
    </div>
  );
}

/** Produits finis qui emploient l'article (tissu principal ou nomenclature). */
function UsageCard({ title, description, empty, models }: { title: string; description: string; empty: string; models: { id: string; name: string }[] }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        {models.length === 0 ? (
          <p className="text-sm text-foreground-muted">{empty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {models.map((m) => (
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
  );
}
