import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { SAMPLE_STATUS_LABELS, SAMPLE_PRIORITY_LABELS, PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import type { SamplePriority } from "@/lib/types/domain";
import { NewSampleForm } from "@/components/samples/new-sample-form";
import { SampleDecisionForm } from "@/components/samples/sample-decision-form";
import { SampleQrCode } from "@/components/samples/sample-qr-code";
import { SampleMediaFiles } from "@/components/samples/sample-media-files";

export default async function ClientSamplesPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();

  const [{ data: samples }, { data: mediaFiles }, { data: sampleMedia }] = await Promise.all([
    supabase
      .from("sample_requests")
      .select(
        "id,reference,sample_number,need_description,quantity_requested,status,priority,due_date,extra_info,production_orders(reference,status)"
      )
      .eq("company_id", profile.company_id!)
      .order("created_at", { ascending: false }),
    supabase.from("media_files").select("id,file_name,category").eq("company_id", profile.company_id!),
    supabase.from("sample_request_media_files").select("sample_request_id,media_file_id"),
  ]);

  const attachedBySample = new Map<string, string[]>();
  for (const link of sampleMedia ?? []) {
    const list = attachedBySample.get(link.sample_request_id) ?? [];
    list.push(link.media_file_id);
    attachedBySample.set(link.sample_request_id, list);
  }
  const companyMedia = mediaFiles ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes échantillons"
        description="Demandez un échantillon avant de vous engager sur une commande ferme."
      />

      <NewSampleForm fixedCompanyId={profile.company_id!} />

      <Card>
        <CardBody className="space-y-4 p-5">
          {samples?.map((s) => {
            const productionOrder = s.production_orders as unknown as { reference: string; status: string } | null;
            const attachedIds = new Set(attachedBySample.get(s.id) ?? []);
            const attached = companyMedia.filter((m) => attachedIds.has(m.id));

            return (
              <div key={s.id} className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{s.reference}</p>
                    <span className="font-mono text-[11px] text-foreground-muted">{s.sample_number}</span>
                    <StatusBadge status={s.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
                    <PriorityBadge priority={s.priority} label={SAMPLE_PRIORITY_LABELS[s.priority as SamplePriority]} />
                  </div>
                  <p className="text-xs text-foreground-muted">
                    {s.need_description} · qté {s.quantity_requested}
                  </p>
                  {s.extra_info && <p className="text-xs italic text-foreground-muted">{s.extra_info}</p>}
                  {productionOrder && (
                    <p className="text-xs text-foreground-muted">
                      Ordre de fabrication lié : {productionOrder.reference} ·{" "}
                      {PRODUCTION_ORDER_STATUS_LABELS[productionOrder.status as keyof typeof PRODUCTION_ORDER_STATUS_LABELS]}
                    </p>
                  )}
                  <SampleMediaFiles sampleId={s.id} attached={attached} available={companyMedia} />
                  {(s.status === "envoye" || s.status === "recu_client") && <SampleDecisionForm sampleId={s.id} />}
                </div>
                <div className="shrink-0">
                  <SampleQrCode value={s.sample_number} size={88} />
                </div>
              </div>
            );
          })}
          {(!samples || samples.length === 0) && (
            <p className="py-6 text-center text-sm text-foreground-muted">Aucune demande d&apos;échantillon.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
