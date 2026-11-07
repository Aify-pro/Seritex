import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { chargerDroits, chargerRubriques } from "../donnees";
import { RubriquesPanel } from "../reglages-panels";

/** Paramètres > Personnel > Rubriques de paie : comment chaque rubrique du livre Sage compte dans le coût. */
export default async function RubriquesPage() {
  await requireModule("personnel");
  const [droits, rubriques] = await Promise.all([chargerDroits(), chargerRubriques()]);

  return (
    <div className="space-y-6">
      <PageHeader title="Rubriques de paie" description="Comment chaque rubrique du livre de paie Sage compte dans le coût. Une rubrique nouvelle arrive « à classer » : elle n'est jamais ignorée en silence." />
      <Card>
        <CardBody>
          <RubriquesPanel rubriques={rubriques} peutModifier={droits.peutModifier} />
        </CardBody>
      </Card>
    </div>
  );
}
