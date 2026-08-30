import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SampleDetailContent } from "@/components/samples/sample-detail-content";
import type { ProductionOrderStatus, MediaFileCategory } from "@/lib/types/domain";

const STAFF_MANAGERS = ["commercial", "administrateur", "responsable_production"] as const;

/**
 * Fiche échantillon autonome, à une URL stable — la cible du QR code
 * imprimé sur la fiche (section 5.2 de l'analyse) : un scan depuis le
 * téléphone d'un membre de l'atelier ouvre directement cette page, après
 * connexion si besoin (le proxy redirige vers `/login?next=...`, repris par
 * `signInAction` — voir `src/app/login/actions.ts`). Accessible à tout rôle
 * authentifié ; la RLS (0002_rls.sql) limite déjà un client à ses propres
 * échantillons, ce que cette page vérifie aussi explicitement en défense en
 * profondeur.
 */
export default async function SampleSheetPage({ params }: { params: Promise<{ sampleNumber: string }> }) {
  const { sampleNumber } = await params;

  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(`/echantillons/${sampleNumber}`)}`);
  const { profile } = current;

  const supabase = await createClient();
  const { data: sample } = await supabase
    .from("sample_requests")
    .select(
      "id,reference,sample_number,need_description,quantity_requested,status,priority,request_date,due_date,extra_info,company_id,production_order_id,companies(name)"
    )
    .eq("sample_number", sampleNumber)
    .maybeSingle();

  if (!sample) notFound();
  if (profile.role === "client" && sample.company_id !== profile.company_id) notFound();

  const isStaffManager = (STAFF_MANAGERS as readonly string[]).includes(profile.role);

  const [{ data: productionOrders }, { data: mediaFiles }, { data: sampleMedia }] = await Promise.all([
    supabase
      .from("production_orders")
      .select("id,reference,status")
      .eq("company_id", sample.company_id),
    supabase.from("media_files").select("id,file_name,category").eq("company_id", sample.company_id),
    supabase.from("sample_request_media_files").select("media_file_id").eq("sample_request_id", sample.id),
  ]);

  const attachedIds = new Set((sampleMedia ?? []).map((m) => m.media_file_id));
  const allMedia = (mediaFiles ?? []) as { id: string; file_name: string; category: MediaFileCategory }[];
  const attachedMedia = allMedia.filter((m) => attachedIds.has(m.id));

  const baseUrl = await getBaseUrl();
  const companyName = (sample.companies as unknown as { name: string } | null)?.name;

  return (
    <div className="space-y-6">
      <PageHeader title="Fiche échantillon" description={sample.reference} />
      <Card>
        <CardBody>
          <SampleDetailContent
            sample={{ ...sample, companyName }}
            baseUrl={baseUrl}
            companyProductionOrders={(productionOrders ?? []) as { id: string; reference: string; status: ProductionOrderStatus }[]}
            attachedMedia={attachedMedia}
            availableMedia={allMedia}
            permissions={{
              canEdit: isStaffManager,
              canDelete: isStaffManager,
              canManageStatus: isStaffManager,
              canLinkProductionOrder: isStaffManager,
              canDecide: profile.role === "client",
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
