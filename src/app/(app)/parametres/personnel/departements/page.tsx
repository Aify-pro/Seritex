import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { chargerDepartements, chargerDroits, chargerSections } from "../donnees";
import { DepartementsPanel } from "../reglages-panels";

/** Paramètres > Personnel > Départements : codes de département de la paie Sage et section de la plateforme. */
export default async function DepartementsPage() {
  await requireModule("personnel");
  const [droits, departements, sections] = await Promise.all([chargerDroits(), chargerDepartements(), chargerSections()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Départements"
        description="Dans le bulletin de salaire de Sage, chaque salarié porte un code de département (001, 002…). Ce tableau dit à quelle section de la plateforme correspond chaque département ; la section d'un employé en découle."
      />
      <Card>
        <CardHeader title="Départements de la paie" description="Bureau, direction, commercial… sont de la structure : aucune section d'atelier." />
        <CardBody>
          <DepartementsPanel departements={departements} sections={sections} peutModifier={droits.peutModifier} peutCreer={droits.peutCreer} />
        </CardBody>
      </Card>
    </div>
  );
}
