import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/types/domain";
import { RealtimeRefresher } from "@/components/shell/realtime-refresher";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

const COUNT_STATUSES: WorkOrderStatus[] = ["en_attente", "planifie", "en_cours", "pause", "bloque", "termine"];

export default async function TransverseAtelierPage() {
  await requireRole(["responsable_production", "administrateur"]);
  const supabase = await createClient();

  const [{ data: sections }, { data: workOrders }] = await Promise.all([
    supabase.from("sections").select("id,name").eq("active", true).order("display_order"),
    supabase
      .from("work_orders")
      .select("id,reference,status,section_id,blocking_reason,production_orders(reference,companies(name))"),
  ]);

  return (
    <div className="space-y-6">
      <RealtimeRefresher table="work_orders" />
      <PageHeader
        title="Vue transverse des sections"
        description="Charge de travail en temps réel dans chaque section de l'atelier."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {sections?.map((section) => {
          const sectionOrders = workOrders?.filter((w) => w.section_id === section.id) ?? [];
          const blocked = sectionOrders.filter((w) => w.status === "bloque");

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
                <div className="grid grid-cols-3 gap-2 text-center">
                  {COUNT_STATUSES.map((s) => (
                    <div key={s} className="rounded-md bg-surface-muted px-2 py-2">
                      <p className="text-lg font-semibold text-foreground">
                        {sectionOrders.filter((w) => w.status === s).length}
                      </p>
                      <p className="text-[10px] text-foreground-muted">{WORK_ORDER_STATUS_LABELS[s]}</p>
                    </div>
                  ))}
                </div>

                {blocked.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {blocked.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-start gap-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          <strong>{b.reference}</strong> —{" "}
                          {(b.production_orders as unknown as { companies?: { name: string } } | null)?.companies
                            ?.name}
                          {b.blocking_reason ? ` : ${b.blocking_reason}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
