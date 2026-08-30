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
import type { ProductionOrderStatus, MediaFileCategory, SamplePriority } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { CreateSampleDialog } from "@/components/samples/create-sample-dialog";
import { SampleDetailContent } from "@/components/samples/sample-detail-content";

/**
 * Liste du module Échantillonnage, refondue pour l'équipe commerciale/atelier :
 * l'essentiel en colonnes (sans le QR code, déplacé dans la prévisualisation
 * et le PDF), la fiche complète et ses actions (modifier, lier un ordre de
 * fabrication, changer le statut, supprimer, imprimer) dans une fenêtre
 * interne ouverte au clic sur "Voir" — même principe pour la création,
 * désormais derrière le bouton "Nouvelle demande" plutôt qu'un formulaire
 * affiché en permanence en haut de la page.
 */
export default async function CommercialSamplesPage() {
  const { profile } = await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();
  const baseUrl = await getBaseUrl();

  // Édition, statut, lien ODF et suppression : ouverts aux 3 rôles qui
  // accèdent à cette page. La création reste réservée au commercial et à
  // l'administrateur (section 2.7 de l'analyse : "le déclencheur peut être
  // le client lui-même ou le commercial pour son compte") — la policy RLS
  // d'insertion ne l'autorise pas non plus pour le responsable production.
  const canManage = true;
  const canCreate = profile.role === "commercial" || profile.role === "administrateur";

  const [{ data: samples }, { data: companies }, { data: productionOrders }, { data: mediaFiles }, { data: sampleMedia }] =
    await Promise.all([
      supabase
        .from("sample_requests")
        .select(
          "id,reference,sample_number,need_description,quantity_requested,status,priority,request_date,due_date,extra_info,company_id,production_order_id,companies(name)"
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
        action={canCreate ? <CreateSampleDialog companies={companies ?? []} canSetPriority /> : undefined}
      />

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>N° / Référence</Th>
                <Th>Entreprise</Th>
                <Th>Besoin</Th>
                <Th align="center">Qté</Th>
                <Th>Priorité</Th>
                <Th>Statut</Th>
                <Th>Délai</Th>
                <Th>ODF lié</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {samples?.map((s) => {
                const companyName = (s.companies as unknown as { name: string } | null)?.name;
                const companyProductionOrders = productionOrdersByCompany.get(s.company_id) ?? [];
                const linkedOrder = companyProductionOrders.find((po) => po.id === s.production_order_id);
                const companyMedia = mediaByCompany.get(s.company_id) ?? [];
                const attachedIds = new Set(attachedBySample.get(s.id) ?? []);
                const attached = companyMedia.filter((m) => attachedIds.has(m.id));

                return (
                  <Tr key={s.id}>
                    <Td>
                      <p className="font-medium text-foreground">{s.reference}</p>
                      <p className="font-mono text-[11px] text-foreground-muted">{s.sample_number}</p>
                    </Td>
                    <Td>{companyName ?? "—"}</Td>
                    <Td className="max-w-[220px]">
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
                    <Td>{formatDate(s.due_date)}</Td>
                    <Td>
                      {linkedOrder ? (
                        <span className="text-xs text-foreground">{linkedOrder.reference}</span>
                      ) : (
                        <span className="text-xs text-foreground-muted">—</span>
                      )}
                    </Td>
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
                            sample={{ ...s, companyName }}
                            baseUrl={baseUrl}
                            companyProductionOrders={companyProductionOrders}
                            attachedMedia={attached}
                            availableMedia={companyMedia}
                            permissions={{
                              canEdit: canManage,
                              canDelete: canManage,
                              canManageStatus: canManage,
                              canLinkProductionOrder: canManage,
                              canDecide: false,
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
              {(!samples || samples.length === 0) && (
                <EmptyRow colSpan={9}>Aucune demande d&apos;échantillon.</EmptyRow>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
