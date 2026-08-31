import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { PatronnageWorkspace } from "@/components/atelier/patronnage/patronnage-workspace";

export default async function PatronnagePage() {
  await requireRole(["responsable_production", "administrateur"]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patronnage"
        description="Bibliothèque de patrons de référence et reconnaissance géométrique des tracés de coupe — tolérance zéro avant validation humaine."
      />
      <PatronnageWorkspace />
    </div>
  );
}
