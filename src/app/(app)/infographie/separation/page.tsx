import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Encre } from "@/lib/separation/nuancier";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { DepotVisuel } from "./depot-visuel";

export default async function SeparationCouleursPage() {
  await requireModule("demandes_graphiques");
  const supabase = await createClient();
  const { data: encres } = await supabase.from("encres").select("id,nom,hex,reference,sous_couche").eq("active", true).order("nom");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Séparation des couleurs"
        description="Déposez un visuel reçu d'un client : l'outil propose les encres à utiliser et un écran par couleur."
      />
      <Card>
        <CardBody>
          <DepotVisuel encres={(encres ?? []) as Encre[]} />
        </CardBody>
      </Card>
    </div>
  );
}
