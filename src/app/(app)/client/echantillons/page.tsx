import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Eye, Printer } from "lucide-react";
import { SAMPLE_STATUS_LABELS, SAMPLE_PRIORITY_LABELS } from "@/lib/types/domain";
import type { SamplePriority, ProductionOrderStatus } from "@/lib/types/domain";
import { CreateSampleDialog } from "@/components/samples/create-sample-dialog";
import { SampleDetailContent } from "@/components/samples/sample-detail-content";

export default async function ClientSamplesPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();
  const baseUrl = await getBaseUrl();

  const [{ data: samples }, { data: mediaFiles }, { data: sampleMedia }] = await Promise.all([
    supabase
      .from("sample_requests")
      .select(
        "id,reference,sample_number,need_description,quantity_requested,status,priority,request_date,due_date,extra_info,company_id,production_order_id,production_orders(id,reference,status)"
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
        action={<CreateSampleDialog fixedCompanyId={profile.company_id!} />}
      />

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>N° / Référence</Th>
                <Th>Besoin</Th>
                <Th align="center">Qté</Th>
                <Th>Priorité</Th>
                <Th>Statut</Th>
                <Th>Commande liée</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {samples?.map((s) => {
                const productionOrder = s.production_orders as unknown as { id: string; reference: string; status: ProductionOrderStatus } | null;
                const attachedIds = new Set(attachedBySample.get(s.id) ?? []);
                const attached = companyMedia.filter((m) => attachedIds.has(m.id));

                return (
                  <Tr key={s.id}>
                    <Td>
                      <p className="font-medium text-foreground">{s.reference}</p>
                      <p className="font-mono text-[11px] text-foreground-muted">{s.sample_number}</p>
                    </Td>
                    <Td className="max-w-[260px]">
                      <p className="truncate text-foreground" title={s.need_description}>
                        {s.need_description}
                      </p>
                    </Td>
                    <Td align="center">{s.quantity_requested}</Td>
                    <Td>
                      <PriorityBadge priority={s.priority} label={SAMPLE_PRIORITY_LABELS[s.priority as SamplePriority]} />
                    </Td>
                    <Td>
                      <StatusBadge status={s.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
                    </Td>
                    <Td>{productionOrder ? productionOrder.reference : "—"}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Dialog
                          size="lg"
                          title="Fiche échantillon"
                          trigger={
                            <Button variant="secondary" size="sm">
                              <Eye className="h-3.5 w-3.5" /> Voir
                            </Button>
                          }
                        >
                          <SampleDetailContent
                            sample={s}
                            baseUrl={baseUrl}
                            companyProductionOrders={productionOrder ? [productionOrder] : []}
                            attachedMedia={attached}
                            availableMedia={companyMedia}
                            permissions={{
                              canEdit: false,
                              canDelete: false,
                              canManageStatus: false,
                              canLinkProductionOrder: false,
                              canDecide: true,
                            }}
                          />
                        </Dialog>
                        <a
                          href={`${baseUrl}/api/echantillons/${s.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
                        >
                          <Printer className="h-3.5 w-3.5" /> PDF
                        </a>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
              {(!samples || samples.length === 0) && <EmptyRow colSpan={7}>Aucune demande d&apos;échantillon.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
