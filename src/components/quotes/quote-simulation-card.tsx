"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/currency";
import { updateQuoteSizePrices } from "@/app/(app)/commercial/actions";
import type { QuoteSimulation, SimulatedLine } from "@/lib/quote-pricing";

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} %`);

/**
 * Simulation du prix de revient d'un devis, pour la Direction (lot E,
 * migrations 0067/0068). Calculée à partir de la configuration saisie par le
 * commercial — modèle, impressions, répartition, prix par taille — sans
 * ressaisie. Pendant la validation interne, la Direction peut rehausser les
 * prix taille par taille ; à la validation, ce chiffrage est figé comme prix de
 * revient théorique. Jamais rendue pour un autre rôle.
 */
export function QuoteSimulationCard({ quoteId, simulation, editable }: { quoteId: string; simulation: QuoteSimulation; editable: boolean }) {
  const { devise } = simulation;
  return (
    <Card className="border-brand/30">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Simulation du prix de revient
          </span>
        }
        description="Visible uniquement de la Direction et de l'administrateur. Prix de revient et marges en F CFA, selon la grille de chaque modèle (Tarification). Le chiffrage est figé à la validation."
      />
      <CardBody className="space-y-5">
        {simulation.lines.length === 0 && <p className="text-sm text-foreground-muted">Aucun article de catalogue sur ce devis : rien à simuler.</p>}
        {simulation.lines.map((l) => (
          <SimulationLine key={l.quoteLineId} quoteId={quoteId} line={l} devise={devise} taux={simulation.tauxChange} editable={editable} />
        ))}
        {simulation.lines.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-4">
            <Stat label="Chiffre d'affaires HT (F CFA)" value={formatMoney(Math.round(simulation.totalVenteXof))} />
            <Stat label="Prix de revient total" value={formatMoney(Math.round(simulation.totalRevientXof))} />
            <Stat label="Coût après charges" value={formatMoney(Math.round(simulation.totalApresChargesXof))} />
            <Stat label="Marge globale" value={pct(simulation.margeGlobalePct)} strong />
          </dl>
        )}
        {devise !== "XOF" && (
          <p className="text-xs text-foreground-muted">
            Devis en {devise} : prix de vente convertis au taux figé du devis (1 {devise} = {simulation.tauxChange} F CFA) pour la comparaison.
          </p>
        )}
        <p className="text-xs text-foreground-muted">Totaux calculés hors remises de ligne et remise globale du devis.</p>
      </CardBody>
    </Card>
  );
}

function SimulationLine({ quoteId, line, devise, taux, editable }: { quoteId: string; line: SimulatedLine; devise: string; taux: number; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(line.sizes.map((s) => [s.cle, String(s.prixVente)])));
  const dirty = line.sizes.some((s) => Number(prices[s.cle]) !== s.prixVente);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{line.description}</p>
      {line.warnings.map((w) => (
        <p key={w} className="text-xs text-danger">
          {w}
        </p>
      ))}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs text-foreground-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Taille</th>
              <th className="px-3 py-2 text-right font-medium">Qté</th>
              <th className="px-3 py-2 text-right font-medium">Prix du devis</th>
              <th className="px-3 py-2 text-right font-medium">Prix grille</th>
              <th className="px-3 py-2 text-right font-medium">Prix de revient</th>
              <th className="px-3 py-2 text-right font-medium">Marge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {line.sizes.map((s) => {
              // Marge recalculée en direct sur le prix saisi.
              const pv = (Number(String(prices[s.cle]).replace(",", ".")) || 0) * taux;
              const apresCharges = s.prixRevient !== null ? s.prixRevient / (1 - line.chargesPct / 100) : null;
              const marge = apresCharges !== null && pv > 0 ? ((pv - apresCharges) / pv) * 100 : null;
              const sousCible = marge !== null && marge < line.margeCiblePct - 0.01;
              return (
                <tr key={s.cle}>
                  <td className="px-3 py-1.5 font-medium text-foreground">{s.libelle}</td>
                  <td className="px-3 py-1.5 text-right">{s.quantite}</td>
                  <td className="px-3 py-1.5 text-right">
                    {editable ? (
                      <input
                        inputMode="decimal"
                        value={prices[s.cle] ?? ""}
                        disabled={pending}
                        onChange={(e) => setPrices({ ...prices, [s.cle]: e.target.value })}
                        className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm"
                      />
                    ) : (
                      formatMoney(s.prixVente, devise)
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-foreground-muted">{s.prixGrille === null ? "—" : formatMoney(s.prixGrille)}</td>
                  <td className="px-3 py-1.5 text-right">{s.prixRevient === null ? "—" : formatMoney(s.prixRevient)}</td>
                  <td className={`px-3 py-1.5 text-right ${sousCible ? "font-medium text-danger" : ""}`}>{pct(marge)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground-muted">
        Charges {line.chargesPct} % · marge cible {line.margeCiblePct} % · impressions {formatMoney(Math.round(line.coutImpression))} par pièce (frais d&apos;écran
        compris). Marge en rouge sous la cible.
      </p>
      {editable && dirty && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const payload = Object.fromEntries(line.sizes.map((s) => [s.cle, Number(String(prices[s.cle]).replace(",", "."))]));
              const res = await updateQuoteSizePrices(quoteId, line.quoteLineId, payload);
              if (res.error) toast.error("Prix non enregistrés", { description: res.error });
              else {
                toast.success("Prix mis à jour — montant du devis recalculé");
                router.refresh();
              }
            })
          }
        >
          Enregistrer les nouveaux prix
        </Button>
      )}
    </div>
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
