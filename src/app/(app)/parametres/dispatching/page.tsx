import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { getSizes } from "@/lib/sizes";
import { getDispatchRules } from "@/lib/quote-dispatch";
import { DispatchRulesManager } from "./rules-manager";

/**
 * Paramètres > Dispatching (migration 0066) : la règle qui propose la
 * répartition par taille de chaque article de devis. Par groupe de tailles,
 * des paliers de quantité portant chacun un pourcentage par taille. Réservé à
 * la Direction et à l'administrateur.
 */
export default async function DispatchingSettingsPage() {
  await requireRole(["administrateur"]);
  const [sizes, rules] = await Promise.all([getSizes(), getDispatchRules()]);
  const groupes = [...new Set(sizes.map((s) => s.groupe))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatching des tailles"
        description="Répartition proposée automatiquement sur chaque article de devis : un pourcentage par taille, par palier de quantité. Le commercial peut l'ajuster, puis le client à l'acceptation ; le total reste toujours égal à la quantité commandée. Une taille qui n'existe pas pour le modèle est écartée et les autres sont recalculées."
      />

      {groupes.map((groupe) => (
        <Card key={groupe}>
          <CardHeader
            title={groupe}
            description="Paliers de quantité (bornes incluses). En cas de chevauchement, le palier qui commence le plus haut l'emporte."
          />
          <CardBody>
            <DispatchRulesManager
              groupe={groupe}
              sizes={sizes.filter((s) => s.groupe === groupe).map((s) => ({ cle: s.cle, libelle: s.libelle }))}
              rules={rules.filter((r) => r.groupe === groupe)}
            />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
