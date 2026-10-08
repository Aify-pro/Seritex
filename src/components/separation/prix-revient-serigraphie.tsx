"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { chiffrer, type EcranChiffre, type ParametresSerigraphie } from "@/lib/separation/prix-revient";

const QUANTITES = [50, 100, 300, 1000];

const f = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} F`;
const f2 = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} F`;

/**
 * Prix de revient de la sérigraphie d'un visuel (Direction seulement : les
 * paramètres et les prix d'encre ne sont lus qu'avec les droits Tarification).
 * Usage interne, jamais communiqué au client.
 */
export function PrixRevientSerigraphie({
  parametres,
  ecrans,
  quantiteInitiale,
}: {
  parametres: ParametresSerigraphie;
  ecrans: EcranChiffre[];
  quantiteInitiale?: number | null;
}) {
  const [quantite, setQuantite] = useState(quantiteInitiale && quantiteInitiale > 0 ? quantiteInitiale : parametres.quantiteRef);
  const c = useMemo(() => chiffrer(parametres, ecrans, quantite), [parametres, ecrans, quantite]);
  const paliers = useMemo(() => QUANTITES.map((q) => ({ q, parPiece: chiffrer(parametres, ecrans, q).parPieceBonne })), [parametres, ecrans]);

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          <Lock className="h-3.5 w-3.5" /> Prix de revient sérigraphie · usage interne
        </p>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          Quantité
          <input
            type="number"
            min={1}
            value={quantite}
            onChange={(e) => setQuantite(Math.max(1, Number(e.target.value) || 1))}
            className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="text-left text-foreground-muted">
            <tr>
              <th className="py-1 font-medium">Écran</th>
              <th className="py-1 text-right font-medium">Surface</th>
              <th className="py-1 text-right font-medium">Encre / pièce</th>
              <th className="py-1 text-right font-medium">Coût encre / pièce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {c.ecrans.map((e, i) => (
              <tr key={i}>
                <td className="py-1.5">{e.libelle}</td>
                <td className="py-1.5 text-right">{Math.round(e.surfaceCm2).toLocaleString("fr-FR")} cm²</td>
                <td className="py-1.5 text-right">{e.grammesPiece.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} g</td>
                <td className="py-1.5 text-right">
                  {e.coutEncrePiece == null ? "prix manquant" : f2(e.coutEncrePiece)}
                  {e.prixParDefaut && <span className="text-foreground-muted"> (prix par défaut)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <dt className="text-foreground-muted">Frais fixes (écrans {f(c.fixe.ecrans)} + calage {f(c.fixe.calage)})</dt>
        <dd className="text-right font-medium sm:text-left">{f(c.fixe.total)}</dd>
        <dt className="text-foreground-muted">
          Par pièce imprimée (encre {f2(c.parPiece.encre)}, impression {f2(c.parPiece.impression)}, séchage {f2(c.parPiece.sechage)})
        </dt>
        <dd className="text-right font-medium sm:text-left">{f2(c.parPiece.total)}</dd>
        <dt className="text-foreground-muted">Pièces imprimées (gâche {parametres.gachePct.toLocaleString("fr-FR")} %)</dt>
        <dd className="text-right font-medium sm:text-left">{c.piecesImprimees.toLocaleString("fr-FR")}</dd>
        <dt className="text-foreground-muted">Total du travail</dt>
        <dd className="text-right font-medium sm:text-left">{f(c.total)}</dd>
        <dt className="font-medium text-foreground">Prix de revient par pièce bonne</dt>
        <dd className="text-right text-sm font-semibold sm:text-left">{f(c.parPieceBonne)}</dd>
      </dl>

      <p className="text-xs text-foreground-muted">
        Selon la quantité : {paliers.map((p) => `${p.q} pièces → ${f(p.parPiece)}`).join(" · ")}
      </p>

      {c.prixManquants.length > 0 && (
        <p className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Encre sans prix ({c.prixManquants.join(", ")}) : comptée 0. Renseignez le prix d&apos;achat de l&apos;article encre, ou un prix par défaut dans
          Paramètres &gt; Tarification.
        </p>
      )}
      <p className="text-xs text-foreground-muted">
        Hors textile : la gâche ne compte que la sérigraphie. Paramètres de l&apos;atelier dans Paramètres &gt; Tarification.
      </p>
    </section>
  );
}
