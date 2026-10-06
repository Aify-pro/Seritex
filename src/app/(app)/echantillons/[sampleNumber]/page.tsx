import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SampleDetailContent } from "@/components/samples/sample-detail-content";
import type { ProductionOrderStatus, MediaFileCategory } from "@/lib/types/domain";
import type { ProductionOrderLineOption } from "@/components/samples/sample-production-order-link";
import { can } from "@/lib/auth/permissions";
import {
  getSampleQuoteLineOptions,
  getSampleArticleMediaMap,
  buildSampleLinks,
  canEditSampleArticleMedia,
  emptySampleArticleMedia,
  getSampleValidatorNames,
  buildSampleValidations,
  SAMPLE_VALIDATION_COLUMNS,
  type SampleRequestOption,
} from "@/lib/samples";

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
      `id,reference,sample_number,need_description,status,priority,request_date,due_date,extra_info,company_id,request_id,quote_line_id,production_order_line_id,companies(name),${SAMPLE_VALIDATION_COLUMNS}`
    )
    .eq("sample_number", sampleNumber)
    .maybeSingle();

  if (!sample) notFound();
  if (profile.role === "client" && sample.company_id !== profile.company_id) notFound();

  const isStaffManager = (STAFF_MANAGERS as readonly string[]).includes(profile.role);
  const isCommercial = profile.role === "commercial" || profile.role === "administrateur";

  const [{ data: productionOrderLines }, { data: mediaFiles }, { data: sampleMedia }, { data: companyRequests }, quoteLines] = await Promise.all([
    // Par article plutôt que par ODF entier (migration 0044).
    supabase
      .from("production_order_lines")
      .select("id,description,production_orders!inner(reference,status,company_id)")
      .eq("production_orders.company_id", sample.company_id),
    supabase.from("media_files").select("id,file_name,category").eq("company_id", sample.company_id),
    supabase.from("sample_request_media_files").select("media_file_id").eq("sample_request_id", sample.id),
    // Demandes de l'entreprise : la demande de la fiche, ou celles proposées
    // au rattachement si elle n'en a pas encore (migration 0051).
    supabase.from("requests").select("id,reference,company_id,description").eq("company_id", sample.company_id).order("created_at", { ascending: false }),
    getSampleQuoteLineOptions(sample.request_id ? [sample.request_id] : []),
  ]);
  const articleMedia = (await getSampleArticleMediaMap([sample])).get(sample.id) ?? emptySampleArticleMedia();
  const [validatorNames, canValidateDirection] = await Promise.all([
    getSampleValidatorNames([sample]),
    can("validation_echantillon", "validate"),
  ]);
  const isClient = profile.role === "client";
  const requests: SampleRequestOption[] = (companyRequests ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    companyId: r.company_id,
    companyName: "",
    description: r.description,
  }));

  const companyProductionOrderLines: ProductionOrderLineOption[] = (productionOrderLines ?? []).map((pol) => {
    const po = pol.production_orders as unknown as { reference: string; status: ProductionOrderStatus };
    return { id: pol.id, description: pol.description, orderReference: po.reference, status: po.status };
  });

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
            links={buildSampleLinks(sample, requests, quoteLines)}
            articleMedia={articleMedia}
            validations={buildSampleValidations(sample, validatorNames)}
            baseUrl={baseUrl}
            companyProductionOrderLines={companyProductionOrderLines}
            attachedMedia={attachedMedia}
            availableMedia={allMedia}
            permissions={{
              canEdit: isStaffManager,
              canDelete: isStaffManager,
              canManageStatus: isStaffManager,
              canLinkProductionOrder: isStaffManager,
              canLinkRequestAndQuoteLine: isCommercial,
              canManageArticleMedia: canEditSampleArticleMedia(profile.role, articleMedia.target),
              // Le client valide pour lui-même ; le commercial peut enregistrer
              // sa réponse ; la direction valide de son côté (0100).
              canValidateClient: isClient || isCommercial,
              canValidateDirection,
              canReject: isClient || isCommercial || canValidateDirection,
              canCancelValidation: canValidateDirection,
              actsForClient: !isClient,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
