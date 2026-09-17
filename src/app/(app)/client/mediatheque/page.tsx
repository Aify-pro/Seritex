import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { MediaLibrary } from "@/components/media/media-library";

export default async function ClientMediathequePage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  const { profile } = await requireRole(["client"]);
  const { requestId } = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Médiathèque"
        description="Vos fichiers (visuels, image de marque, fiches techniques...), triés par date d'ajout."
      />
      <MediaLibrary companyId={profile.company_id!} requestId={requestId ?? null} />
    </div>
  );
}
