import { requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { DepotVisuel } from "./depot-visuel";

export default async function SeparationCouleursPage() {
  await requireModule("demandes_graphiques");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Séparation des couleurs"
        description="Déposez un visuel reçu d'un client : l'outil propose les encres à utiliser et un écran par couleur."
      />
      <Card>
        <CardBody>
          <DepotVisuel />
        </CardBody>
      </Card>
    </div>
  );
}
