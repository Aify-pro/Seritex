import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { MediaLibrary } from "@/components/media/media-library";

export default async function MediathequeCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ requestId?: string }>;
}) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const { companyId } = await params;
  const { requestId } = await searchParams;
  const supabase = await createClient();

  const { data: company } = await supabase.from("companies").select("id,name").eq("id", companyId).single();
  if (!company) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={`Médiathèque · ${company.name}`} description="Triée par date d'ajout, historique documenté." />
      <MediaLibrary companyId={companyId} requestId={requestId ?? null} />
    </div>
  );
}
