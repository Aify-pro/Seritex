import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { SAMPLE_STATUS_LABELS, SAMPLE_PRIORITY_LABELS } from "@/lib/types/domain";
import type { ProductionOrderStatus, MediaFileCategory, SamplePriority } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { SampleStatusSelect } from "@/components/samples/sample-status-select";
import { NewSampleForm } from "@/components/samples/new-sample-form";
import { SampleDetailsForm } from "@/components/samples/sample-details-form";
import { SampleQrCode } from "@/components/samples/sample-qr-code";
import { SampleProductionOrderLink } from "@/components/samples/sample-production-order-link";
import { SampleMediaFiles } from "@/components/samples/sample-media-files";

export default async function CommercialSamplesPage() {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const [{ data: samples }, { data: companies }, { data: productionOrders }, { data: mediaFiles }, { data: sampleMedia }] =
    await Promise.all([
      supabase
        .from("sample_requests")
        .select(
          "id,reference,sample_number,need_description,quantity_requested,status,priority,due_date,extra_info,company_id,production_order_id,companies(name)"
        )
        .order("created_at", { ascending: false }),
      supabase.from("companies").select("id,name").order("name"),
      supabase.from("production_orders").select("id,reference,status,company_id"),
      supabase.from("media_files").select("id,file_name,category,company_id"),
      supabase.from("sample_request_media_files").select("sample_request_id,media_file_id"),
    ]);

  const productionOrdersByCompany = new Map<string, { id: string; reference: string; status: ProductionOrderStatus }[]>();
  for (const po of productionOrders ?? []) {
    const list = productionOrdersByCompany.get(po.company_id) ?? [];
    list.push({ id: po.id, reference: po.reference, status: po.status });
    productionOrdersByCompany.set(po.company_id, list);
  }

  const mediaByCompany = new Map<string, { id: string; file_name: string; category: MediaFileCategory }[]>();
  for (const mf of mediaFiles ?? []) {
    const list = mediaByCompany.get(mf.company_id) ?? [];
    list.push({ id: mf.id, file_name: mf.file_name, category: mf.category });
    mediaByCompany.set(mf.company_id, list);
  }

  const attachedBySample = new Map<string, string[]>();
  for (const link of sampleMedia ?? []) {
    const list = attachedBySample.get(link.sample_request_id) ?? [];
    list.push(link.media_file_id);
    attachedBySample.set(link.sample_request_id, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Échantillonnage"
        description="Suivi léger, indépendant des ordres de travail — du besoin exprimé à la décision client."
      />

      <NewSampleForm companies={companies ?? []} canSetPriority />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {samples?.map((s) => {
              const companyName = (s.companies as unknown as { name: string } | null)?.name;
              const companyMedia = mediaByCompany.get(s.company_id) ?? [];
              const attachedIds = new Set(attachedBySample.get(s.id) ?? []);
              const attached = companyMedia.filter((m) => attachedIds.has(m.id));

              return (
                <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {s.reference} · {companyName}
                      </p>
                      <span className="font-mono text-[11px] text-foreground-muted">{s.sample_number}</span>
                      <StatusBadge status={s.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
                      <PriorityBadge priority={s.priority} label={SAMPLE_PRIORITY_LABELS[s.priority as SamplePriority]} />
                    </div>
                    <p className="text-xs text-foreground-muted">
                      {s.need_description} · qté {s.quantity_requested}
                      {s.due_date ? ` · délai ${formatDate(s.due_date)}` : ""}
                    </p>
                    {s.extra_info && <p className="text-xs italic text-foreground-muted">{s.extra_info}</p>}
                    <SampleDetailsForm sampleId={s.id} priority={s.priority} dueDate={s.due_date} extraInfo={s.extra_info} />
                    <SampleProductionOrderLink
                      sampleId={s.id}
                      currentProductionOrderId={s.production_order_id}
                      companyProductionOrders={productionOrdersByCompany.get(s.company_id) ?? []}
                    />
                    <SampleMediaFiles sampleId={s.id} attached={attached} available={companyMedia} />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <SampleQrCode value={s.sample_number} size={88} />
                    <SampleStatusSelect sampleId={s.id} current={s.status} />
                  </div>
                </li>
              );
            })}
            {(!samples || samples.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune demande d&apos;échantillon.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
