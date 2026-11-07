import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { chargerAteliers, chargerDroits, chargerSections } from "../donnees";
import { AteliersPanel } from "../reglages-panels";

/** Paramètres > Personnel > Ateliers et sections : atelier d'origine (application Fiche de tâches) → section. */
export default async function AteliersPage() {
  await requireModule("personnel");
  const [droits, ateliers, sections] = await Promise.all([chargerDroits(), chargerAteliers(), chargerSections()]);

  return (
    <div className="space-y-6">
      <PageHeader title="Ateliers et sections" description="L'atelier d'un employé vient de l'application Fiche de tâches. Le département de la paie l'emporte quand il est renseigné ; l'atelier sert à défaut." />
      <Card>
        <CardHeader title="Ateliers" description="Bureau, direction et commercial sont de la structure." />
        <CardBody>
          <AteliersPanel ateliers={ateliers} sections={sections} peutModifier={droits.peutModifier} />
        </CardBody>
      </Card>
    </div>
  );
}
