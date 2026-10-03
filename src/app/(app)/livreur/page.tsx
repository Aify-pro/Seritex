import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";

/** Écran du livreur (L4) — ses livraisons du jour arrivent avec les expéditions. */
export default async function LivreurPage() {
  await requireRole(["livreur", "responsable_livraison", "administrateur"]);
  return (
    <div className="space-y-6">
      <PageHeader title="Mes livraisons" />
      <Card>
        <CardBody className="text-sm text-foreground-muted">Aucune livraison ne vous est confiée pour le moment.</CardBody>
      </Card>
    </div>
  );
}
