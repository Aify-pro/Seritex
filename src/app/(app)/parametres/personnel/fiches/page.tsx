import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { chargerDroits, chargerEmployes, chargerSections } from "../donnees";
import { PersonnelManager } from "../personnel-manager";

/** Paramètres > Personnel > Fiches : une fiche par employé, créée par l'import de la liste du personnel. */
export default async function FichesPage() {
  await requireModule("personnel");
  const [droits, { employes, moisPaie }, sections] = await Promise.all([chargerDroits(), chargerEmployes(), chargerSections()]);

  return (
    <div className="space-y-6">
      <PageHeader title="Fiches du personnel" description="Une fiche par employé, créée par l'import de la liste du personnel. Un employé confidentiel n'a aucun montant. Le coût affiché vient du dernier livre de paie appliqué." />
      <Card>
        <CardBody>
          <PersonnelManager
            employes={employes}
            sections={sections}
            moisPaie={moisPaie}
            peutCreer={droits.peutCreer}
            peutModifier={droits.peutModifier}
            peutSupprimer={droits.peutSupprimer}
          />
        </CardBody>
      </Card>
    </div>
  );
}
