import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { SAMPLE_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { SampleStatusSelect } from "@/components/samples/sample-status-select";
import { NewSampleForm } from "@/components/samples/new-sample-form";

export default async function CommercialSamplesPage() {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const [{ data: samples }, { data: companies }] = await Promise.all([
    supabase
      .from("sample_requests")
      .select("id,reference,need_description,quantity_requested,status,due_date,companies(name)")
      .order("created_at", { ascending: false }),
    supabase.from("companies").select("id,name").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Échantillonnage"
        description="Suivi léger, indépendant des ordres de travail — du besoin exprimé à la décision client."
      />

      <NewSampleForm companies={companies ?? []} />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {samples?.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {s.reference} · {(s.companies as unknown as { name: string } | null)?.name}
                  </p>
                  <p className="truncate text-xs text-foreground-muted">
                    {s.need_description} · qté {s.quantity_requested}
                    {s.due_date ? ` · échéance ${formatDate(s.due_date)}` : ""}
                  </p>
                </div>
                <StatusBadge status={s.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
                <SampleStatusSelect sampleId={s.id} current={s.status} />
              </li>
            ))}
            {(!samples || samples.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune demande d&apos;échantillon.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
