import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { Size } from "@/lib/sizes";
import type { FlowStageRow } from "@/lib/production/flow";

export interface WhereArePiecesLine {
  id: string;
  description: string;
  /** Libellé de chaque étape (sections de l'étape, « + » si en parallèle). */
  stepLabels: Record<number, string>;
  stages: FlowStageRow[];
}

/**
 * « Où sont mes pièces » (SF-1) : pour chaque article, une ligne par étape du
 * parcours et une colonne par taille. Chaque case montre l'en-cours de
 * l'étape (pièces reçues pas encore déclarées), et en dessous ce qui en est
 * déjà sorti. Entrée = Bonnes + Déchets + En cours, partout — calculé par
 * line_stage_flow() côté base.
 */
export function WhereArePieces({ lines, sizes }: { lines: WhereArePiecesLine[]; sizes: Size[] }) {
  const withData = lines.filter((l) => l.stages.length > 0);
  if (withData.length === 0) return null;

  const order = (cle: string) => {
    const i = sizes.findIndex((s) => s.cle === cle);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;

  return (
    <Card>
      <CardHeader
        title="Où sont mes pièces"
        description="Par article, étape et taille : en-cours de l'étape (en gras), puis ce qui en est sorti — bonnes, déchets, 1er et 2e choix en finition."
      />
      <CardBody className="space-y-5">
        {withData.map((line) => {
          const tailles = [...new Set(line.stages.map((s) => s.taille))].sort((a, b) => order(a) - order(b));
          const etapes = [...new Set(line.stages.map((s) => s.etape))].sort((a, b) => a - b);
          const cell = (etape: number, taille: string) => line.stages.find((s) => s.etape === etape && s.taille === taille);
          const derniere = etapes[etapes.length - 1];
          return (
            <div key={line.id} className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{line.description}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                      <th className="py-1.5 pr-3">Étape</th>
                      {tailles.map((t) => (
                        <th key={t} className="px-2 py-1.5 text-center">
                          {libelle(t)}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {etapes.map((etape) => {
                      const rows = tailles.map((t) => cell(etape, t));
                      const total = (f: (r: FlowStageRow) => number) => rows.reduce((s, r) => s + (r ? f(r) : 0), 0);
                      const isFinition = etape === derniere;
                      const sortie = (r: FlowStageRow) =>
                        isFinition
                          ? `${r.premierChoix} · ${r.deuxiemeChoix} · ${r.dechets}`
                          : `${r.bonnes} · ${r.dechets}`;
                      return (
                        <tr key={etape}>
                          <td className="py-1.5 pr-3 align-top">
                            <p className="font-medium text-foreground">
                              {etape}. {line.stepLabels[etape] ?? "—"}
                            </p>
                            <p className="text-[10px] text-foreground-muted">
                              {isFinition ? "en cours · 1er · 2e · déchets" : "en cours · bonnes · déchets"}
                            </p>
                          </td>
                          {rows.map((r, i) => (
                            <td key={tailles[i]} className="px-2 py-1.5 text-center align-top tabular-nums">
                              {r ? (
                                <>
                                  <p className={r.enCours > 0 ? "font-semibold text-brand" : "text-foreground-muted"}>
                                    {r.enCours}
                                  </p>
                                  <p className="text-[10px] text-foreground-muted">{sortie(r)}</p>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center align-top tabular-nums">
                            <p className="font-semibold text-foreground">{total((r) => r.enCours)}</p>
                            <p className="text-[10px] text-foreground-muted">
                              {isFinition
                                ? `${total((r) => r.premierChoix)} · ${total((r) => r.deuxiemeChoix)} · ${total((r) => r.dechets)}`
                                : `${total((r) => r.bonnes)} · ${total((r) => r.dechets)}`}
                            </p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
