import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { NewProductModelForm } from "./new-product-model-form";
import { ProductModelActiveToggle } from "./product-model-active-toggle";
import { ZoneTemplateEditor } from "./zone-template-editor";
import { ProductModelSageReference } from "./product-model-sage-reference";

export default async function ProductModelsPage() {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const [{ data: models }, { data: zones }] = await Promise.all([
    supabase.from("product_models").select("id,name,category,active,sage_reference").order("name"),
    supabase.from("product_zone_templates").select("*").order("display_order"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modèles de produits"
        description="Chaque modèle a son propre gabarit de zones (section 8) : la liste de zones nommées proposée sur l'écran ODF pour choisir une couleur par zone. Un devis, une gamme opératoire ou un article Sage s'y rattachent aussi."
      />

      <NewProductModelForm />

      <div className="space-y-4">
        {models?.map((m) => {
          const modelZones = (zones ?? []).filter((z) => z.product_model_id === m.id);
          return (
            <Card key={m.id}>
              <CardHeader
                title={m.name}
                description={m.category ?? "Sans catégorie"}
                action={<ProductModelActiveToggle productModelId={m.id} active={m.active} />}
              />
              <CardBody className="space-y-4">
                <ProductModelSageReference productModelId={m.id} sageReference={m.sage_reference} />
                <ZoneTemplateEditor productModelId={m.id} zones={modelZones} />
              </CardBody>
            </Card>
          );
        })}
        {(!models || models.length === 0) && (
          <p className="text-sm text-foreground-muted">Aucun modèle de produit pour le moment.</p>
        )}
      </div>
    </div>
  );
}
