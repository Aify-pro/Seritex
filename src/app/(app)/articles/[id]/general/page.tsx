import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { IdentityForm } from "../_components/identity-form";
import { ProductModelActiveToggle } from "../_components/product-model-active-toggle";
import { ProductModelTextile } from "../_components/product-model-textile";
import { ProductModelSageReference } from "../_components/product-model-sage-reference";
import { AvailabilityEditor } from "../_components/availability-editor";

/** Onglet Général : identité, matière, disponibilité (tailles et couleurs). */
export default async function ArticleGeneralPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: model }, { data: textiles }, { data: sizes }, { data: colors }, { data: modelSizes }, { data: modelColors }] =
    await Promise.all([
      supabase.from("product_models").select("id,name,category,active,sage_reference,textile_id").eq("id", id).single(),
      supabase.from("textiles").select("id,nom").eq("active", true).order("nom"),
      supabase.from("sizes").select("id,groupe,libelle").eq("active", true).order("groupe").order("display_order"),
      supabase.from("colors").select("id,name").eq("active", true).order("name"),
      supabase.from("product_model_sizes").select("size_id").eq("product_model_id", id),
      supabase.from("product_model_colors").select("color_id").eq("product_model_id", id),
    ]);
  if (!model) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Identité"
          action={canModify ? <ProductModelActiveToggle productModelId={model.id} active={model.active} /> : undefined}
        />
        <CardBody className="space-y-4">
          <IdentityForm productModelId={model.id} name={model.name} category={model.category} editable={canModify} />
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
