import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { NewTemplateForm } from "./new-template-form";
import { AddStepForm } from "./add-step-form";
import { ArrowRight } from "lucide-react";

export default async function RoutingTemplatesPage() {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const [{ data: templates }, { data: sections }] = await Promise.all([
    supabase
      .from("routing_templates")
      .select("id,name,active,routing_steps(id,sequence_order,standard_duration_minutes,instructions,sections(name))")
      .order("name"),
    supabase.from("sections").select("id,name").eq("active", true).order("display_order"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gammes opératoires"
        description="Chaque modèle de produit suit une gamme : la séquence de sections qu'il doit traverser. Configurable par produit, pas figée."
      />

      <NewTemplateForm />

      <div className="space-y-4">
        {templates?.map((t) => {
          const steps = (t.routing_steps as unknown as {
            id: string;
            sequence_order: number;
            standard_duration_minutes: number | null;
            sections: { name: string } | null;
          }[]).sort((a, b) => a.sequence_order - b.sequence_order);

          return (
            <Card key={t.id}>
              <CardHeader title={t.name} description={t.active ? "Active" : "Inactive"} />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {steps.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-2">
                      <span className="rounded-md bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand">
                        {i + 1}. {s.sections?.name}
                        {s.standard_duration_minutes ? ` (${s.standard_duration_minutes} min)` : ""}
                      </span>
                      {i < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-foreground-muted" />}
                    </span>
                  ))}
                  {steps.length === 0 && <p className="text-xs text-foreground-muted">Aucune étape définie.</p>}
                </div>
                <AddStepForm templateId={t.id} sections={sections ?? []} />
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
