import { requireModule } from "@/lib/auth/permissions";
import { chargerEncres, chargerParametresSerigraphie } from "@/lib/separation/encres-serveur";
import { chargerRecettes } from "@/lib/separation/recettes-serveur";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { DepotVisuel } from "./depot-visuel";

export default async function SeparationCouleursPage() {
  const { profile } = await requireModule("demandes_graphiques");
  const [encres, parametres, recettes] = await Promise.all([chargerEncres(), chargerParametresSerigraphie(), chargerRecettes(profile)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Séparation des couleurs"
        description="Déposez un visuel reçu d'un client : l'outil propose les encres à utiliser et un écran par couleur."
      />
      <Card>
        <CardBody>
          <DepotVisuel encres={encres} parametres={parametres} recettes={recettes} />
        </CardBody>
      </Card>
    </div>
  );
}
