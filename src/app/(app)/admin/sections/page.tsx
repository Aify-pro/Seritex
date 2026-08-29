import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewSectionForm } from "./new-section-form";
import { SectionActiveToggle } from "./section-active-toggle";

export default async function SectionsPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();

  const { data: sections } = await supabase.from("sections").select("*").order("display_order");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections de l'atelier"
        description="Référentiel administrable — ajoutez une section (contrôle qualité, emballage, broderie...) sans toucher au code."
      />

      <NewSectionForm />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {sections?.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
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
