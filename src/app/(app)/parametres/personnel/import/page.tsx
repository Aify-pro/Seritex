import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { chargerAlertes, chargerDroits, chargerImports } from "../donnees";
import { ImportPanel } from "../import-panel";
import { AlertesPanel } from "../reglages-panels";

/** Paramètres > Personnel > Import mensuel : livre de paie Sage, liste du personnel (Excel), présence. */
export default async function ImportMensuelPage() {
  await requireModule("personnel");
  const [droits, imports, alertes] = await Promise.all([chargerDroits(), chargerImports(), chargerAlertes()]);
  const ouvertes = alertes.filter((a) => a.statut === "ouverte");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import mensuel"
        description="Le livre de paie exporté de Sage chaque fin de mois, la liste du personnel (Excel) ou la présence. Un aperçu s'affiche, puis la RH valide. Les salaires ne sont visibles que des rôles qui ont le droit « Personnel »."
      />
      {ouvertes.length > 0 && (
        <Card>
          <CardHeader title={`Alertes (${ouvertes.length} ouverte${ouvertes.length > 1 ? "s" : ""})`} description="Livre de paie identique au précédent, écart anormal… Vues de la RH et de la direction." />
          <CardBody>
            <AlertesPanel alertes={ouvertes} peutTraiter={droits.peutValider} />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Importer un fichier" description="Choisissez le type de fichier : un aperçu s'affiche avant toute écriture." />
        <CardBody>
          <ImportPanel imports={imports} peutDeposer={droits.peutCreer} peutValider={droits.peutValider} />
        </CardBody>
      </Card>
    </div>
  );
}
