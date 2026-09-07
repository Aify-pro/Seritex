import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { RealtimeRefresher } from "@/components/shell/realtime-refresher";
import Link from "next/link";

export default async function TransverseAtelierPage() {
  await requireRole(["responsable_production", "administrateur"]);
  const supabase = await createClient();

  const [{ data: sections }, { data: workOrders }] = await Promise.all([
    supabase.from("sections").select("id,name").eq("active", true).order("display_order"),
    supabase.from("work_orders").select("id,reference,section_id,quantity_planned,quantity_done"),
  ]);

  return (
    <div className="space-y-6">
      <RealtimeRefresher table="work_orders" />
      <PageHeader
        title="Vue transverse des sections"
        description="Avancement en temps réel dans chaque section de l'atelier."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {sections?.map((section) => {
          const sectionOrders = workOrders?.filter((w) => w.section_id === section.id) ?? [];
          const enCours = sectionOrders.filter((w) => w.quantity_done < w.quantity_planned);
          const atteintes = sectionOrders.filter((w) => w.quantity_done >= w.quantity_planned);

          return (
            <Card key={section.id}>
              <CardHeader
                title={section.name}
                action={
                  <Link
                    href={`/atelier/section?section=${section.id}`}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Gérer →
                  </Link>
                }
              />
              <CardBody>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-md bg-surface-muted px-2 py-2">
                    <p className="text-lg font-semibold text-foreground">{enCours.length}</p>
                    <p className="text-[10px] text-foreground-muted">En cours</p>
                  </div>
                  <div className="rounded-md bg-surface-muted px-2 py-2">
                    <p className="text-lg font-semibold text-foreground">{atteintes.length}</p>
                    <p className="text-[10px] text-foreground-muted">Quantité atteinte</p>
                  </div>
                </div>

                {sectionOrders.length === 0 && (
                  <p className="mt-3 text-center text-xs text-foreground-muted">Aucun ordre de travail.</p>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
