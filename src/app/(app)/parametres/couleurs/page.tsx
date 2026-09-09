import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewColorForm } from "./new-color-form";
import { ColorActiveToggle } from "./color-active-toggle";

export default async function ColorsPage() {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { data: colors } = await supabase.from("colors").select("*").order("name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Palette de couleurs"
        description="Référentiel unique, utilisable pour n'importe quelle zone et n'importe quel tissu (section 9) — la disponibilité réelle n'est pas suivie ici, seulement notée en commentaire libre sur chaque ODF."
      />

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
    </div>
  );
}
