import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewColorForm } from "./new-color-form";
import { ColorActiveToggle } from "./color-active-toggle";
import { NewSizeForm } from "./new-size-form";
import { SizeActiveToggle } from "./size-active-toggle";

export default async function ColorsPage() {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const [{ data: colors }, { data: sizes }] = await Promise.all([
    supabase.from("colors").select("*").order("name"),
    // Tri par groupe puis par l'ordre saisi : une grille de tailles ne
    // s'ordonne ni alphabétiquement ni numériquement (XS < S < M < L < XL).
    supabase.from("sizes").select("*").order("groupe").order("display_order"),
  ]);

  const groupes = [...new Set((sizes ?? []).map((t) => t.groupe as string))];
  const tailleParGroupe = new Map<string, typeof sizes>();
  for (const t of sizes ?? []) {
    const g = t.groupe as string;
    tailleParGroupe.set(g, [...(tailleParGroupe.get(g) ?? []), t]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Couleurs et tailles"
        description="Les deux référentiels que tout le reste consomme : les couleurs affectées aux zones d'un ODF, et les tailles proposées au dispatching. La disponibilité de chaque modèle se déclare sur sa carte, dans Modèles de produits."
      />

      <h2 className="text-sm font-semibold text-foreground">Couleurs</h2>
      <NewColorForm />

      <Card>
        <CardBody className="p-0">
          {!colors || colors.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucune couleur enregistrée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {colors.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-5 w-5 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: c.code }}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      <p className="font-mono text-xs text-foreground-muted">{c.code}</p>
                    </div>
                  </div>
                  <ColorActiveToggle colorId={c.id} active={c.active} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3 pt-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Tailles</h2>
          <p className="text-xs text-foreground-muted">
            Le groupe distingue deux tailles de même nom : un « M » homme et un « M » femme sont deux tailles
            différentes, et c&apos;est la paire groupe + libellé qui voyage jusqu&apos;aux tracés de placement.
            L&apos;ordre fixe la position dans la grille — l&apos;alphabet ne sait pas que XS vient avant S.
          </p>
        </div>

        <NewSizeForm groupes={groupes} />

        <Card>
          <CardBody className="p-0">
            {!sizes || sizes.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground-muted">
                Aucune taille enregistrée. Tant que le référentiel est vide, aucune quantité par taille ne peut être
                saisie sur un ODF.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {[...tailleParGroupe.entries()].map(([groupe, tailles]) => (
                  <div key={groupe} className="px-5 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">{groupe}</p>
                    <ul className="flex flex-wrap gap-2">
                      {(tailles ?? []).map((t) => (
                        <li
                          key={t.id}
                          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
                        >
                          <span className="text-sm font-medium text-foreground">{t.libelle}</span>
                          <SizeActiveToggle sizeId={t.id} active={t.active} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
