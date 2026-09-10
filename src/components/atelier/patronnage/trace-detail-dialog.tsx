"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PieceOverlay } from "@/components/atelier/patronnage/piece-overlay";
import type { TraceAnalysisDetail } from "@/lib/patronnage/detail";

/**
 * Fenêtre "Détail" d'un tracé déjà déposé — montre CE QUE le moteur a
 * extrait du fichier et comparé à la bibliothèque, pièce par pièce
 * (contour détecté superposé à sa référence, score et détail des écarts),
 * là où la carte du tracé ne montre que des totaux par patron.
 *
 * Purement présentationnel : le chargement (`getTraceDetail`) est déclenché
 * par l'appelant (bouton "Détail" de `TraceCard`, via `useTransition`), pas
 * ici — recalculé à la demande, reflète toujours la bibliothèque actuelle,
 * jamais un instantané figé au moment du dépôt.
 */
export function TraceDetailDialog({
  open,
  onOpenChange,
  traceReference,
  loading,
  error,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  traceReference: string;
  loading: boolean;
  error: string | null;
  detail: TraceAnalysisDetail | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Détail — ${traceReference}`} size="lg">
      <div className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-foreground-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyse du tracé…
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        {detail && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
              <span>{detail.totalDetected} pièce(s) détectée(s)</span>
              <span>·</span>
              <span>{detail.allRecognized ? "100% reconnues" : `${detail.unrecognized.length} non reconnue(s)`}</span>
              {detail.scaleAlert && (
                <>
                  <span>·</span>
                  <span>facteur d&apos;échelle ×{detail.scaleFactor} (score {Math.round(detail.scoreEchelle * 100)}%)</span>
                </>
              )}
              {detail.mirrorAlert && (
                <>
                  <span>·</span>
                  <span>pièce(s) en miroir</span>
                </>
              )}
            </div>

            {Object.keys(detail.detailEchelle).length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground-muted">
                  Pré-passe d&apos;échelle — score par facteur testé
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(detail.detailEchelle).map(([facteur, score]) => (
                    <span
                      key={facteur}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        Number(facteur) === detail.scaleFactor
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-border text-foreground-muted"
                      }`}
                    >
                      ×{facteur} : {Math.round(score * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detail.recognized.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground-muted">Patrons reconnus</p>
                <div className="space-y-2">
                  {detail.recognized.map((g) => (
                    <div key={g.patternPieceId} className="flex items-center gap-3 rounded-md border border-success/30 bg-success-soft/40 p-2">
                      <PieceOverlay candidatePoints={g.exampleCandidatePoints} referencePoints={g.referencePoints} ok />
                      <div className="flex-1 text-sm">
                        <p className="text-foreground">
                          {g.articleCode} · {g.size} · {g.pieceName}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          contour détecté (plein) superposé à la référence (pointillés)
                          {g.mirroredCount > 0 && (
                            <span className="ml-1 text-warning">— dont {g.mirroredCount} en miroir</span>
                          )}
                        </p>
                      </div>
                      <Badge tone="success">×{g.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.unrecognized.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground-muted">Pièces non reconnues</p>
                <div className="space-y-2">
                  {detail.unrecognized.map((p) => (
                    <div key={p.index} className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger-soft/40 p-2">
                      <PieceOverlay
                        candidatePoints={p.points}
                        referencePoints={p.bestGuess?.referencePoints}
                        ok={false}
                      />
                      <div className="flex-1 text-sm">
                        <p className="text-foreground">
                          Pièce #{p.index + 1} (calque {p.layer}) · {p.area} u² · {p.perimeter} u de périmètre
                        </p>
                        {p.bestGuess ? (
                          <p className="text-xs text-foreground-muted">
                            Piste la plus proche : {p.bestGuess.articleCode} · {p.bestGuess.size} ·{" "}
                            {p.bestGuess.pieceName} — {p.bestGuess.confidence}% (écart aire{" "}
                            {p.bestGuess.areaDiffPct}%, périmètre {p.bestGuess.perimDiffPct}%, forme{" "}
                            {p.bestGuess.shapeDiffPct}%)
                          </p>
                        ) : (
                          <p className="text-xs text-foreground-muted">Aucune piste dans la bibliothèque actuelle.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
