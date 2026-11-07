import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { chargerAlertes, chargerDroits } from "../donnees";
import { AlertesPanel } from "../reglages-panels";

/** Paramètres > Personnel > Alertes : livre de paie identique au précédent, écart anormal… */
export default async function AlertesPage() {
  await requireModule("personnel");
  const [droits, alertes] = await Promise.all([chargerDroits(), chargerAlertes()]);

  return (
    <div className="space-y-6">
      <PageHeader title="Alertes" description="Livre de paie identique ou quasi identique au précédent, variation anormale… Vues de la RH et de la direction ; elles alimenteront la zone alertes du tableau de bord." />
      <Card>
        <CardBody>
          <AlertesPanel alertes={alertes} peutTraiter={droits.peutValider} />
        </CardBody>
      </Card>
    </div>
  );
}
