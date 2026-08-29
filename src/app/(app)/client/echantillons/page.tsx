import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { SAMPLE_STATUS_LABELS } from "@/lib/types/domain";
import { NewSampleForm } from "@/components/samples/new-sample-form";
import { SampleDecisionForm } from "@/components/samples/sample-decision-form";

export default async function ClientSamplesPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();

  const { data: samples } = await supabase
    .from("sample_requests")
    .select("id,reference,need_description,quantity_requested,status,due_date")
    .eq("company_id", profile.company_id!)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes échantillons"
        description="Demandez un échantillon avant de vous engager sur une commande ferme."
      />

      <NewSampleForm fixedCompanyId={profile.company_id!} />

      <Card>
        <CardBody className="space-y-4 p-5">
          {samples?.map((s) => (
            <div key={s.id} className="space-y-2 rounded-md border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{s.reference}</p>
                <StatusBadge status={s.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
              </div>
              <p className="text-xs text-foreground-muted">
                {s.need_description} · qté {s.quantity_requested}
              </p>
              {(s.status === "envoye" || s.status === "recu_client") && <SampleDecisionForm sampleId={s.id} />}
            </div>
          ))}
          {(!samples || samples.length === 0) && (
            <p className="py-6 text-center text-sm text-foreground-muted">Aucune demande d&apos;échantillon.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
