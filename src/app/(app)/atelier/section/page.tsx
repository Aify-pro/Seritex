import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { SectionBoard, type WorkOrderRow } from "./section-board";
import { SectionSwitcher } from "./section-switcher";
import { Card, CardBody } from "@/components/ui/card";

export default async function SectionQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { profile } = await requireRole(["chef_section", "responsable_production", "administrateur"]);
  const supabase = await createClient();
  const params = await searchParams;

  let sectionId = profile.section_id;
  let sections: { id: string; name: string }[] = [];

  if (profile.role !== "chef_section") {
    const { data } = await supabase.from("sections").select("id,name").eq("active", true).order("display_order");
    sections = data ?? [];
    sectionId = params.section ?? sections[0]?.id ?? null;
  }

  if (!sectionId) {
    return (
      <Card>
        <CardBody>Aucune section disponible.</CardBody>
      </Card>
    );
  }

  const { data: section } = await supabase.from("sections").select("id,name").eq("id", sectionId).single();

  const { data: workOrders } = await supabase
    .from("work_orders")
    .select(
      "id,reference,status,quantity_planned,quantity_done,blocking_reason,planned_start,planned_end,actual_start,production_orders(id,reference,company_id,companies(name))"
    )
    .eq("section_id", sectionId)
    .order("planned_start", { ascending: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`File de travail — ${section?.name ?? ""}`}
        description="Démarrez, mettez en pause, signalez un incident ou terminez vos ordres de travail."
        action={
          sections.length > 0 ? <SectionSwitcher sections={sections} value={sectionId} /> : undefined
        }
      />

      <SectionBoard
        key={sectionId}
        sectionId={sectionId}
        initialWorkOrders={(workOrders ?? []) as unknown as WorkOrderRow[]}
      />
    </div>
  );
}
