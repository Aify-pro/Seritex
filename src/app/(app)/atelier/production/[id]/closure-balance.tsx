import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { Size } from "@/lib/sizes";

/** Bilan figé par production_order_balance() à la demande de clôture (SF-1, migration 0072). */
export interface ClosureBalanceData {
  en_cours: number;
  lignes: {
    line_id: string;
    description: string;
    quantite: number;
    en_cours: number;
    tailles: {
      taille: string;
      demande: number;
      premier_choix: number;
      deuxieme_choix: number;
      dechets: number;
      en_cours: number;
    }[];
  }[];
}

/**
 * Bilan de clôture d'un ODF, par article et par taille : ce qui était demandé,
 * ce qui est sorti en 1er et 2e choix, les déchets et ce qui restait en cours.
 */
export function ClosureBalance({ bilan, motif, sizes }: { bilan: ClosureBalanceData; motif: string | null; sizes: Size[] }) {
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;
  return (
    <Card>
      <CardHeader
        title="Bilan de clôture"
        description={
          bilan.en_cours > 0
            ? `${bilan.en_cours} pièce(s) encore en cours à la demande de clôture.`
            : "Aucune pièce en cours à la demande de clôture."
        }
      />
      <CardBody className="space-y-4">
        {motif && (
          <p className="rounded-md bg-warning-soft px-2.5 py-2 text-xs text-warning">Motif (en-cours restant) : {motif}</p>
        )}
        {bilan.lignes.map((l) => (
          <div key={l.line_id} className="overflow-x-auto">
            <p className="mb-1 text-sm font-medium text-foreground">{l.description}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-1.5 pr-3">Taille</th>
                  <th className="px-2 py-1.5 text-right">Demandé</th>
                  <th className="px-2 py-1.5 text-right">1er choix</th>
                  <th className="px-2 py-1.5 text-right">2e choix</th>
                  <th className="px-2 py-1.5 text-right">Déchets</th>
                  <th className="px-2 py-1.5 text-right">En cours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {l.tailles.map((t) => (
                  <tr key={t.taille}>
                    <td className="py-1.5 pr-3 font-medium">{libelle(t.taille)}</td>
                    <td className="px-2 py-1.5 text-right">{t.demande}</td>
                    <td className="px-2 py-1.5 text-right">{t.premier_choix}</td>
                    <td className="px-2 py-1.5 text-right">{t.deuxieme_choix}</td>
                    <td className="px-2 py-1.5 text-right">{t.dechets}</td>
                    <td className={`px-2 py-1.5 text-right ${t.en_cours > 0 ? "font-semibold text-warning" : ""}`}>{t.en_cours}</td>
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
