import { PIECE_STATUT_LABELS, type PieceCoupeeGroupe } from "@/lib/pieces-coupees";

const signe = (v: number) => (v > 0 ? `+${v}` : String(v));

/**
 * Tableau des pièces coupées par semi-fini (migration 0146), en lecture
 * seule : coupé par taille du patron, total, attendu par la nomenclature et
 * écart. Les pièces hors semi-fini sont signalées sous leur nom.
 */
export function PiecesCoupeesTable({ groupes, tailles }: { groupes: PieceCoupeeGroupe[]; tailles: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
            <th className="py-1.5 pr-3">Pièce</th>
            {tailles.map((t) => (
              <th key={t} className="px-2 py-1.5 text-right">
                {t}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right">Coupé</th>
            <th className="px-2 py-1.5 text-right">Attendu</th>
            <th className="px-2 py-1.5 text-right">Écart</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {groupes.map((g) => (
            <tr key={g.key}>
              <td className="py-1.5 pr-3">
                <span className="font-medium">{g.libelle}</span>
                {g.statut !== "semi_fini" && <span className="block text-[11px] text-warning">{PIECE_STATUT_LABELS[g.statut]}</span>}
              </td>
              {tailles.map((t) => (
                <td key={t} className="px-2 py-1.5 text-right">
                  {g.parTaille[t] ?? "—"}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-semibold">{g.coupe}</td>
              <td className="px-2 py-1.5 text-right">{g.attendu ?? "—"}</td>
              <td className={`px-2 py-1.5 text-right font-semibold ${g.ecart !== null && g.ecart < 0 ? "text-danger" : g.ecart ? "text-warning" : ""}`}>
                {g.ecart === null ? "—" : g.ecart === 0 ? "0" : signe(g.ecart)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
