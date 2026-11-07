import { formatAmount } from "@/lib/utils";

export interface SageDocumentLine {
  line_no: number;
  ar_ref: string | null;
  designation: string;
  quantity: number | string;
  unit_price: number | string;
  remise_pct: number | string;
  total_ht: number | string;
  piece_devis: string | null;
  piece_commande: string | null;
  piece_bl: string | null;
}

/**
 * Lignes d'une pièce Sage (ODF, facture d'achat) dans la fenêtre de détail.
 * Les lignes à quantité 0 sont des instructions (impression, broderie) : elles
 * restent affichées, sans prix. La colonne « Origine » ne paraît que si Sage a
 * conservé au moins un lien vers le devis, l'ODF ou le BL d'origine.
 */
export function SageDocumentLines({ lines, noun }: { lines: SageDocumentLine[]; noun: string }) {
  const withOrigin = lines.some((l) => l.piece_devis || l.piece_commande || l.piece_bl);
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">
        Lignes {noun} ({lines.length})
      </h3>
      {lines.length === 0 ? (
        <p className="text-sm text-foreground-muted">Aucune ligne synchronisée pour cette pièce.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left uppercase tracking-wide text-foreground-muted">
                <th className="px-3 py-2 font-medium">Référence</th>
                <th className="px-3 py-2 font-medium">Désignation</th>
                <th className="px-3 py-2 text-right font-medium">Qté</th>
                <th className="px-3 py-2 text-right font-medium">PU HT</th>
                <th className="px-3 py-2 text-right font-medium">Remise</th>
                <th className="px-3 py-2 text-right font-medium">Total HT</th>
                {withOrigin && <th className="px-3 py-2 font-medium">Origine</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => {
                const instruction = Number(l.quantity) === 0;
                const origin = [l.piece_devis && `devis ${l.piece_devis}`, l.piece_commande && `ODF ${l.piece_commande}`, l.piece_bl && `BL ${l.piece_bl}`]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={l.line_no}>
                    <td className="px-3 py-2 font-mono text-foreground-muted">{l.ar_ref ?? "—"}</td>
                    <td className="px-3 py-2 text-foreground">{l.designation}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">{instruction ? "—" : Number(l.quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">{instruction ? "—" : formatAmount(Number(l.unit_price))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">
                      {Number(l.remise_pct) ? `${Number(l.remise_pct)} %` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{instruction ? "—" : formatAmount(Number(l.total_ht))}</td>
                    {withOrigin && <td className="px-3 py-2 text-foreground-muted">{origin || "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
