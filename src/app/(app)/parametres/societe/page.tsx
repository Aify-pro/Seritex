import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { getCompanySettings } from "@/lib/company-settings";
import { PageHeader } from "@/components/shell/page-header";
import { formatDateTime } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { Currency, PaymentTerm } from "@/lib/types/domain";
import { CompanySettingsForm } from "./company-settings-form";
import { PaymentTermsManager } from "./payment-terms-manager";
import { CurrenciesManager } from "./currencies-manager";

/**
 * Paramètres > Informations société (migration 0061) : la fiche de
 * l'émetteur relue par tous les documents commerciaux et administratifs
 * (proforma PDF aujourd'hui). Une seule fiche pour toute la plateforme.
 */
export default async function SocieteSettingsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [settings, { data: terms }, { data: currencies }] = await Promise.all([
    getCompanySettings(),
    supabase.from("payment_terms").select("*").order("display_order"),
    supabase.from("currencies").select("*").order("display_order"),
  ]);

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

          <Card>
            <CardHeader
              title="Conditions de paiement"
              description="Liste proposée à la création d'un devis. Les quatre conditions de base peuvent être désactivées ; celles que vous ajoutez peuvent être supprimées. Un devis déjà émis conserve la condition choisie."
            />
            <CardBody>
              <PaymentTermsManager terms={(terms ?? []) as PaymentTerm[]} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Devises"
              description="Le franc CFA reste la devise de base. Pour vendre dans une autre devise (vente à l'export, vente en ligne), activez-la avec un taux de change : il pré-remplit chaque devis, est modifiable devis par devis puis figé à l'émission. L'euro est à parité fixe avec le franc CFA (655,957)."
            />
            <CardBody>
              <CurrenciesManager currencies={(currencies ?? []) as Currency[]} />
            </CardBody>
          </Card>
        </>
      ) : (
        <p className="text-sm text-foreground-muted">
          La fiche société n&apos;existe pas encore : la migration 0061 n&apos;a pas été appliquée.
        </p>
      )}
    </div>
  );
}
