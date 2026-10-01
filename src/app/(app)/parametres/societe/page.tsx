import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { getCompanySettings } from "@/lib/company-settings";
import { PageHeader } from "@/components/shell/page-header";
import { formatDateTime } from "@/lib/utils";
import { CompanySettingsForm } from "./company-settings-form";

/**
 * Paramètres > Informations société (migration 0061) : la fiche de
 * l'émetteur relue par tous les documents commerciaux et administratifs
 * (proforma PDF aujourd'hui). Une seule fiche pour toute la plateforme.
 */
export default async function SocieteSettingsPage() {
  await requirePlatformAdmin();
  const settings = await getCompanySettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Informations société"
        description="Identité légale, coordonnées, banque et valeurs par défaut de Seritex — reprises automatiquement sur les devis / proformas PDF et sur les futurs documents commerciaux et administratifs."
      />
      {settings ? (
        <>
          <CompanySettingsForm settings={settings} />
          <p className="text-xs text-foreground-muted">Dernière modification : {formatDateTime(settings.updated_at)}</p>
        </>
      ) : (
        <p className="text-sm text-foreground-muted">
          La fiche société n&apos;existe pas encore : la migration 0061 n&apos;a pas été appliquée.
        </p>
      )}
    </div>
  );
}
