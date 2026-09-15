import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewSectionForm } from "./new-section-form";
import { SectionActiveToggle } from "./section-active-toggle";

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
        description="Référentiel administrable — ajoutez une section (contrôle qualité, emballage, broderie...) sans toucher au code. Rattachez-la à une catégorie d'atelier (Coupe, Impression...) pour lui donner le comportement associé."
      />

      <NewSectionForm categories={categories ?? []} />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {sections?.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {s.name}
                    {s.atelier_categories && (
                      <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-normal text-brand">
                        {(s.atelier_categories as unknown as { nom: string }).nom}
                      </span>
                    )}
                  </p>
                  {s.description && <p className="text-xs text-foreground-muted">{s.description}</p>}
                </div>
                <SectionActiveToggle sectionId={s.id} active={s.active} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
