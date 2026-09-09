import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  sortie_mp: "Sortie MP",
  entree_semi_fini: "Entrée semi-fini",
  sortie_semi_fini: "Sortie semi-fini",
  entree_fini: "Entrée fini",
  retour_mp: "Retour MP",
};

/**
 * Fiche d'export stock autonome, à une URL stable (lot 10, section 19 du
 * document de logique) — le document que la personne qui importe dans Sage
 * consulte pour savoir précisément quoi saisir. Pas de QR ici (à la
 * différence de /lots/[code] et /dechets/[code]) : ce n'est pas une
 * étiquette physique scannée en atelier, juste un document consulté à
 * l'écran ou imprimé. Outil interne — pas de portée client, même principe
 * que les autres fiches de traçabilité.
 */
export default async function StockExportFichePage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;

  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(`/stock/fiches/${numero}`)}`);
  if (current.profile.role === "client") notFound();

  const supabase = await createClient();
  const { data: fiche } = await supabase
    .from("stock_export_fiches")
    .select("id,numero,generated_at,generated_by,production_orders(reference,companies(name))")
    .eq("numero", numero)
    .maybeSingle();

  if (!fiche) notFound();

  const { data: generatedByUser } = fiche.generated_by
    ? await supabase.from("app_users").select("full_name").eq("id", fiche.generated_by).maybeSingle()
    : { data: null };

  const { data: movements } = await supabase
    .from("stock_movements")
    .select("id,type,article_ref,quantite_ou_poids,unite,created_at")
    .eq("exported_in_fiche_id", fiche.id)
    .order("created_at", { ascending: true });

  const productionOrder = fiche.production_orders as unknown as { reference: string; companies: { name: string } | null } | null;

  return (
    <div className="space-y-6">
      <PageHeader title="Fiche d'export stock" description={fiche.numero} />
      <Card>
        <CardBody className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-foreground-muted">Ordre de fabrication</p>
            <p className="font-medium text-foreground">
              {productionOrder?.reference ?? "—"}
              {productionOrder?.companies?.name ? ` · ${productionOrder.companies.name}` : ""}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Générée le</p>
            <p className="font-medium text-foreground">{formatDateTime(fiche.generated_at)}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Générée par</p>
            <p className="font-medium text-foreground">{generatedByUser?.full_name ?? "—"}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Mouvements inclus"
          description="À reporter dans l'outil d'import de Sage — Seritex n'écrit jamais directement dans Sage."
        />
        <CardBody className="p-0">
          {!movements || movements.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucun mouvement dans cette fiche.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Référence Sage</th>
                    <th className="px-5 py-3 font-medium">Quantité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 text-foreground">{STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                      <td className="px-5 py-3 font-mono text-xs text-foreground-muted">{m.article_ref ?? "—"}</td>
                      <td className="px-5 py-3 text-foreground-muted">
                        {m.quantite_ou_poids} {m.unite === "kg" ? "kg" : "pièce(s)"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
