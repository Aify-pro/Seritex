import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatMoney } from "@/lib/currency";
import { formatDate } from "@/lib/utils";
import { getOdfRealCosts } from "@/lib/real-cost-data";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)} %`);

/**
 * Prix de revient réel des ODF (lot F, migration 0070) — Direction et
 * administrateur. Théorique figé à la validation du devis face au réel, dont
 * seule la part tissu change (pesées × prix au kg).
 */
export default async function RealCostsPage() {
  await requireRole(["administrateur"]);
  const odfs = await getOdfRealCosts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prix de revient réel"
        description="Pour chaque ordre de fabrication issu d'un devis chiffré : prix de revient théorique (figé à la validation du devis) et réel. Seul le tissu change — kg pesés (réception − retour stock) × prix au kg ; le reste est repris du théorique."
        action={
          <Link href="/tarification" className="text-sm text-brand hover:underline">
            ← Tarification
          </Link>
        }
      />
      <Card>
        <CardBody className="p-0">
          {odfs.length === 0 ? (
            <p className="p-5 text-sm text-foreground-muted">Aucun ordre de fabrication issu d&apos;un devis.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs text-foreground-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">ODF</th>
                    <th className="px-4 py-2 font-medium">Statut</th>
                    <th className="px-4 py-2 text-right font-medium">Tissu pesé</th>
                    <th className="px-4 py-2 text-right font-medium">PR théorique</th>
                    <th className="px-4 py-2 text-right font-medium">PR réel</th>
                    <th className="px-4 py-2 text-right font-medium">Écart</th>
                    <th className="px-4 py-2 text-right font-medium">Marge théo. → réelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {odfs.map((o) => {
                    const r = o.result;
                    return (
                      <tr key={o.id}>
                        <td className="px-4 py-3">
                          <Link href={`/tarification/realise/${o.id}`} className="font-medium text-foreground hover:text-brand">
                            {o.reference}
                          </Link>
                          <p className="text-xs text-foreground-muted">
                            {o.companyName ?? "—"} · {formatDate(o.createdAt)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={o.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
                        </td>
                        <td className="px-4 py-3 text-right">{o.kgReception > 0 ? `${(o.kgReception - o.kgRetour).toFixed(1)} kg` : "—"}</td>
                        {!o.hasTheoretical ? (
                          <td colSpan={4} className="px-4 py-3 text-right text-xs text-foreground-muted">
                            Pas de chiffrage figé (devis validé avant la tarification)
                          </td>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-right">{formatMoney(Math.round(r!.theorique.prixRevient))}</td>
                            <td className="px-4 py-3 text-right">{r!.reel ? formatMoney(Math.round(r!.reel.prixRevient)) : "—"}</td>
                            <td className={`px-4 py-3 text-right ${r!.ecart !== null && r!.ecart > 0 ? "font-medium text-danger" : ""}`}>
                              {r!.ecart === null ? "—" : `${r!.ecart > 0 ? "+" : ""}${formatMoney(Math.round(r!.ecart))} (${pct(r!.ecartPct)})`}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {pct(r!.theorique.margePct)} → {pct(r!.reel?.margePct)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
