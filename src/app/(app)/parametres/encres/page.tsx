import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewEncreForm } from "./new-encre-form";
import { EncreRowActions } from "./encre-row-actions";
import type { EncreRow } from "./encre-fields";

export default async function EncresPage() {
  await requireModule("encres");
  const [canCreate, canModify, canDelete] = await Promise.all([can("encres", "create"), can("encres", "modify"), can("encres", "delete")]);
  const supabase = await createClient();
  const { data } = await supabase.from("encres").select("id,nom,hex,reference,gamme,sous_couche,active").order("nom");
  const encres = (data ?? []) as EncreRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuancier d'encres"
        description="Les encres de l'atelier. L'outil « Séparation des couleurs » rapproche chaque couleur trouvée de l'encre la plus proche et reprend son nom sur les films. L'encre marquée « Sous-couche » sert de blanc sous les couleurs sur textile foncé."
      />

      {canCreate && <NewEncreForm />}

      <Card>
        <CardBody className="p-0">
          {encres.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">
              Aucune encre enregistrée. Tant que le nuancier est vide, l&apos;outil de séparation affiche les couleurs trouvées sans les rapprocher d&apos;une encre.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {encres.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="h-5 w-5 shrink-0 rounded-full border border-border" style={{ backgroundColor: e.hex }} aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-foreground">{e.nom}</p>
                      <p className="font-mono text-xs text-foreground-muted">
                        {[e.hex, e.reference, e.gamme].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {e.sous_couche && <Badge tone="neutral">Sous-couche</Badge>}
                  </div>
                  <EncreRowActions encre={e} canModify={canModify} canDelete={canDelete} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
