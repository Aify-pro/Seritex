import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Size } from "@/lib/sizes";
import type { CouvertureArticle } from "@/lib/production/couverture-coupe";

const signe = (v: number) => (v > 0 ? `+${v}` : String(v));

/**
 * Couverture de coupe par article et par taille (TR-1b, migration 0148),
 * calculée en continu : coupé (matelas clôturés) + à couper (tracés validés)
 * face au demandé. Les tracés en préparation sont montrés à part : ils ne
 * comptent qu'une fois validés. Aucune tolérance : tout écart est signalé.
 */
export function CouvertureCoupeCard({ articles, sizes }: { articles: CouvertureArticle[]; sizes: Size[] }) {
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;
  return (
    <Card>
      <CardHeader
        title="Couverture de coupe"
        description="Coupé (matelas clôturés) + à couper (tracés Bon pour coupe ou en coupe) − demandé. Un manque appelle un tracé de rattrapage ; un surplus se réduit (plis, annulation d'un tracé non coupé) ou garde son motif."
      />
      <CardBody className="space-y-4">
        {articles.map((a) => (
          <div key={a.lineId} className="overflow-x-auto">
            <p className="mb-1 text-sm font-medium text-foreground">{a.description}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-1.5 pr-3">Taille</th>
                  <th className="px-2 py-1.5 text-right">Demandé</th>
                  <th className="px-2 py-1.5 text-right">Coupé</th>
                  <th className="px-2 py-1.5 text-right">À couper</th>
                  <th className="px-2 py-1.5 text-right">Écart</th>
                  <th className="px-2 py-1.5 text-right">En préparation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {a.tailles.map((t) => (
                  <tr key={t.taille}>
                    <td className="py-1.5 pr-3 font-medium">{libelle(t.taille)}</td>
                    <td className="px-2 py-1.5 text-right">{t.demande}</td>
                    <td className="px-2 py-1.5 text-right">{t.coupe}</td>
                    <td className="px-2 py-1.5 text-right">{t.a_couper}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${t.ecart < 0 ? "text-danger" : t.ecart > 0 ? "text-warning" : "text-success"}`}>
                      {t.ecart === 0 ? "0" : signe(t.ecart)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-foreground-muted">{t.en_preparation || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
