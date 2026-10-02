import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/currency";
import { getOdfRealCosts } from "@/lib/real-cost-data";
import { OdfRealCostForm } from "./odf-real-cost-form";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)} %`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(Math.round(v)));

/** Prix de revient réel d'un ODF (lot F, migration 0070) — Direction et administrateur. */
export default async function OdfRealCostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["administrateur"]);
  const { id } = await params;
  const [odf] = await getOdfRealCosts([id]);
  if (!odf) notFound();
  const r = odf.result;
  const unitaire = (total: number | null | undefined) => (total === null || total === undefined || !r?.quantite ? null : total / r.quantite);
  const textilePlaceholder =
    odf.textiles.length === 1 && odf.textiles[0].prixKg !== null
      ? `${odf.textiles[0].prixKg} (${odf.textiles[0].nom})`
      : odf.textiles.length > 1
        ? "Plusieurs textiles : prix à saisir"
        : "Prix du textile non renseigné";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Prix de revient réel — ${odf.reference}`}
        description={odf.companyName ?? undefined}
        action={
          <Link href="/tarification/realise" className="text-sm text-brand hover:underline">
            ← Tous les ODF
          </Link>
        }
      />

      {!odf.hasTheoretical || !r ? (
        <Card>
          <CardBody className="text-sm text-foreground-muted">
            Aucun chiffrage figé pour cet ODF : son devis a été validé avant la mise en service de la tarification. Le prix de revient réel se compare au théorique
            figé à la validation du devis.
          </CardBody>
        </Card>
      ) : (
        <>
          {r.warnings.length > 0 && (
            <Card className="border-warning/40 bg-warning-soft/40">
              <CardBody>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                  {r.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Théorique et réel" description={`${r.quantite} pièce(s) chiffrée(s) · chiffre d'affaires HT ${money(r.chiffreAffaires)} (hors remises)`} />
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-xs text-foreground-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium" />
                      <th className="px-4 py-2 text-right font-medium">Théorique</th>
                      <th className="px-4 py-2 text-right font-medium">Réel</th>
                      <th className="px-4 py-2 text-right font-medium">Écart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <Row label="Tissu (total)" theo={r.tissuTheorique} reel={r.tissuReel} />
                    <Row label="Prix de revient (total)" theo={r.theorique.prixRevient} reel={r.reel?.prixRevient ?? null} strong />
                    <Row label="Prix de revient par pièce" theo={unitaire(r.theorique.prixRevient)} reel={unitaire(r.reel?.prixRevient)} />
                    <Row label="Coût après charges (total)" theo={r.theorique.apresCharges} reel={r.reel?.apresCharges ?? null} />
                    <tr>
                      <td className="px-4 py-2 font-medium text-foreground">Marge après charges</td>
                      <td className="px-4 py-2 text-right">{pct(r.theorique.margePct)}</td>
                      <td className="px-4 py-2 text-right">{pct(r.reel?.margePct)}</td>
                      <td className="px-4 py-2 text-right">
                        {r.reel?.margePct != null && r.theorique.margePct != null ? `${(r.reel.margePct - r.theorique.margePct).toFixed(1)} pt` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Consommation de tissu" description="Pesées de l'ODF : réception tissu moins retour stock. Les kg théoriques traduisent le tissu théorique au prix au kg retenu." />
            <CardBody>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <Stat label="Reçu" value={`${odf.kgReception.toFixed(1)} kg`} />
                <Stat label="Retourné au stock" value={`${odf.kgRetour.toFixed(1)} kg`} />
                <Stat label="Consommé (pesé)" value={odf.kgReception > 0 ? `${(odf.kgReception - odf.kgRetour).toFixed(1)} kg` : "—"} strong />
                <Stat label="Théorique" value={r.kgTheoriques === null ? "—" : `${r.kgTheoriques.toFixed(1)} kg`} />
                <Stat label="Pièces obtenues (coupe)" value={odf.piecesObtenues === null ? "—" : String(odf.piecesObtenues)} />
              </dl>
              <p className="mt-3 text-xs text-foreground-muted">
                Prix au kg retenu : {odf.prixKg === null ? "non renseigné" : `${formatMoney(odf.prixKg)} (${odf.prixKgSource === "odf" ? "propre à cet ODF" : "prix du textile"})`}.
              </p>
            </CardBody>
          </Card>
        </>
      )}

      <Card>
        <CardHeader title="Paramètres de l'analyse" />
        <CardBody>
          <OdfRealCostForm odfId={odf.id} prixKgOdf={odf.prixKgOdf} notes={odf.notes} textilePlaceholder={textilePlaceholder} />
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, theo, reel, strong = false }: { label: string; theo: number | null; reel: number | null; strong?: boolean }) {
  const ecart = theo !== null && reel !== null ? reel - theo : null;
  return (
    <tr>
      <td className={`px-4 py-2 ${strong ? "font-semibold" : "font-medium"} text-foreground`}>{label}</td>
      <td className="px-4 py-2 text-right">{money(theo)}</td>
      <td className="px-4 py-2 text-right">{money(reel)}</td>
      <td className={`px-4 py-2 text-right ${ecart !== null && ecart > 0.5 ? "font-medium text-danger" : ""}`}>
        {ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${money(ecart)}`}
      </td>
    </tr>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className={strong ? "text-base font-semibold text-foreground" : "font-medium text-foreground"}>{value}</dd>
    </div>
  );
}
