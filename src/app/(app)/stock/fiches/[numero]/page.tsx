import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { Download } from "lucide-react";
import { SageReconciliationForm } from "./sage-reconciliation-form";

const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  sortie_mp: "Sortie MP",
  entree_semi_fini: "Entrée semi-fini",
  sortie_semi_fini: "Sortie semi-fini",
  entree_fini: "Entrée fini",
  retour_mp: "Retour MP",
};

const STOCK_MANAGER_ROLES = ["administrateur", "responsable_production", "gestionnaire_stock"];

/**
 * Fiche d'export stock autonome, à une URL stable (lot 10, section 19 du
 * document de logique) — le document que la personne qui importe dans Sage
 * consulte pour savoir précisément quoi saisir. Pas de QR ici (à la
 * différence de /lots/[code] et /dechets/[code]) : ce n'est pas une
 * étiquette physique scannée en atelier, juste un document consulté à
 * l'écran ou imprimé. Outil interne — pas de portée client, même principe
 * que les autres fiches de traçabilité.
 *
 * Peut désormais être globale (production_order_id null, migration 0038) :
 * générée depuis /atelier/stock pour tous les ODF en une fois plutôt qu'un
 * par un — d'où la colonne ODF sur le tableau des mouvements, utile même en
 * mode ODF unique (coût d'affichage nul).
 */
export default async function StockExportFichePage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;

  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(`/stock/fiches/${numero}`)}`);
  if (current.profile.role === "client") notFound();

  const supabase = await createClient();
  const { data: fiche } = await supabase
    .from("stock_export_fiches")
    .select(
      "id,numero,generated_at,generated_by,production_orders(reference,companies(name)),sage_numero,sage_rapproche_le,sage_rapproche_par"
    )
    .eq("numero", numero)
    .maybeSingle();

  if (!fiche) notFound();

  const [{ data: generatedByUser }, { data: rapprocheParUser }] = await Promise.all([
    fiche.generated_by
      ? supabase.from("app_users").select("full_name").eq("id", fiche.generated_by).maybeSingle()
      : Promise.resolve({ data: null }),
    fiche.sage_rapproche_par
      ? supabase.from("app_users").select("full_name").eq("id", fiche.sage_rapproche_par).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: movements } = await supabase
    .from("stock_movements")
    .select("id,type,article_ref,quantite_ou_poids,unite,created_at,production_orders(reference)")
    .eq("exported_in_fiche_id", fiche.id)
    .order("created_at", { ascending: true });

  const productionOrder = fiche.production_orders as unknown as { reference: string; companies: { name: string } | null } | null;
  const isGlobal = !productionOrder;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiche d'export stock"
        description={fiche.numero}
        action={
          <a
            href={`/api/stock/fiches/${fiche.numero}/csv`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            <Download className="h-3.5 w-3.5" /> Télécharger le CSV
          </a>
        }
      />
      <Card>
        <CardBody className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-foreground-muted">Ordre de fabrication</p>
            <p className="font-medium text-foreground">
              {isGlobal
                ? `Global — ${
                    new Set(
                      (movements ?? [])
                        .map((m) => (m.production_orders as unknown as { reference: string } | null)?.reference)
                        .filter((ref): ref is string => !!ref)
                    ).size
                  } ODF`
                : `${productionOrder.reference}${productionOrder.companies?.name ? ` · ${productionOrder.companies.name}` : ""}`}
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
          title="Rapprochement Sage"
          description="Une fois ce CSV importé côté Sage, reportez ici le numéro de fiche de mouvement que Sage a renvoyé — connexion réelle à venir, saisie manuelle en attendant."
          action={
            <Badge tone={fiche.sage_numero ? "success" : "warning"}>
              {fiche.sage_numero ? "Rapproché" : "En attente d'import Sage"}
            </Badge>
          }
        />
        <CardBody>
          {fiche.sage_numero ? (
            <p className="text-sm text-foreground">
              N° Sage <span className="font-mono font-medium">{fiche.sage_numero}</span> — rapproché le{" "}
              {formatDateTime(fiche.sage_rapproche_le!)} par {rapprocheParUser?.full_name ?? "—"}
            </p>
          ) : STOCK_MANAGER_ROLES.includes(current.profile.role) ? (
            <SageReconciliationForm ficheId={fiche.id} />
          ) : (
            <p className="text-sm text-foreground-muted">Pas encore rapproché.</p>
          )}
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
                    {isGlobal && <th className="px-5 py-3 font-medium">ODF</th>}
                    <th className="px-5 py-3 font-medium">Référence Sage</th>
                    <th className="px-5 py-3 font-medium">Quantité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 text-foreground">{STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                      {isGlobal && (
                        <td className="px-5 py-3 text-foreground-muted">
                          {(m.production_orders as unknown as { reference: string } | null)?.reference ?? "—"}
                        </td>
                      )}
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
