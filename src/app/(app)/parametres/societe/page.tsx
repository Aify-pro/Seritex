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
import { CompanyStampManager, SignatoriesManager, type SignatoryRow, type StaffOption } from "./seals-manager";

/**
 * Paramètres > Informations société (migration 0061) : la fiche de
 * l'émetteur relue par tous les documents commerciaux et administratifs
 * (proforma PDF aujourd'hui). Une seule fiche pour toute la plateforme.
 */
export default async function SocieteSettingsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [settings, { data: terms }, { data: currencies }, { data: stamp }, { data: sigRows }, { data: staffUsers }] = await Promise.all([
    getCompanySettings(),
    supabase.from("payment_terms").select("*").order("display_order"),
    supabase.from("currencies").select("*").order("display_order"),
    // Cachet et signatures (migration 0062) : lisibles par l'administrateur de plateforme uniquement.
    supabase.from("company_stamp").select("image_png").limit(1).maybeSingle(),
    supabase.from("document_signatories").select("user_id,fonction,active,signature_png,app_users!document_signatories_user_id_fkey(full_name,role)").order("created_at"),
    supabase.from("app_users").select("id,full_name,role").in("role", ["commercial", "administrateur"]).eq("active", true).order("full_name"),
  ]);
  const signatories: SignatoryRow[] = (sigRows ?? []).map((r) => {
    const u = r.app_users as unknown as { full_name: string; role: string } | null;
    return { user_id: r.user_id, full_name: u?.full_name ?? "Compte supprimé", role: u?.role ?? "", fonction: r.fonction, active: r.active, signature_png: r.signature_png };
  });

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

          <Card>
            <CardHeader
              title="Cachet de la société"
              description="Apposé avec la signature sur les documents de vente. Le cachet n'apparaît jamais seul : uniquement sur un document validé par une personne ayant une signature active."
            />
            <CardBody>
              <CompanyStampManager stampPng={stamp?.image_png ?? null} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Signatures des validateurs"
              description="Une signature par compte (commercial ou administrateur). Avoir une signature active rend habilité à VALIDER les proformas avant leur envoi au client ; la signature, avec le cachet, est apposée sur les proformas que ce compte a validées. Sans validation, aucune signature."
            />
            <CardBody>
              <SignatoriesManager signatories={signatories} staff={(staffUsers ?? []) as StaffOption[]} />
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
