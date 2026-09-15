import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewSectionForm } from "./new-section-form";
import { SectionActiveToggle } from "./section-active-toggle";
import { SectionDetailsForm } from "./section-details-form";
import { SectionCategorySelect } from "./section-category-select";

export default async function SectionsPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();

  const [{ data: sections }, { data: categories }] = await Promise.all([
    supabase.from("sections").select("*,atelier_categories(nom)").order("display_order"),
    supabase.from("atelier_categories").select("id,nom").eq("active", true).order("display_order"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections de l'atelier"
        description="Référentiel administrable — ajoutez une section (contrôle qualité, emballage, broderie...) sans toucher au code, et modifiez-la ensuite (nom, description, catégorie) à tout moment. Rattachez-la à une catégorie d'atelier (Coupe, Impression...) pour lui donner le comportement associé — les catégories elles-mêmes restent fixes, une nouvelle se décide et s'ajoute par migration."
      />

      <NewSectionForm categories={categories ?? []} />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {sections?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-end justify-between gap-3 px-5 py-3">
                <SectionDetailsForm sectionId={s.id} name={s.name} description={s.description} />
                <div className="flex items-end gap-2">
                  <SectionCategorySelect
                    sectionId={s.id}
                    categorieId={s.categorie_id}
                    categories={categories ?? []}
                  />
                  <SectionActiveToggle sectionId={s.id} active={s.active} />
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
