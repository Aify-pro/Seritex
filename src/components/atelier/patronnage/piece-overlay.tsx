import { cn } from "@/lib/utils";
import type { Point } from "@/lib/patronnage/geometry";

/* ============================================================
   Rendu SVG d'une pièce (candidat vs référence superposés)
   Pur rendu : toute la géométrie (aire, périmètre, signature,
   comparaison) est calculée côté serveur, jamais recalculée ici.
   Partagé par la bibliothèque de patrons et la fenêtre de détail
   d'un tracé — un seul endroit qui sait dessiner une pièce.
============================================================ */

function piecesBounds(pieces: Point[][]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pts of pieces) {
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function toSvgPath(points: Point[], bounds: ReturnType<typeof piecesBounds>, pad = 6): string {
  const w = bounds.maxX - bounds.minX || 1;
  const h = bounds.maxY - bounds.minY || 1;
  const scale = Math.min((100 - 2 * pad) / w, (100 - 2 * pad) / h);
  return (
    points
      .map(([x, y], i) => {
        const sx = pad + (x - bounds.minX) * scale;
        const sy = 100 - (pad + (y - bounds.minY) * scale);
        return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

export function PieceOverlay({
  candidatePoints,
  referencePoints,
  ok,
  className,
}: {
  candidatePoints: Point[];
  referencePoints?: Point[] | null;
  ok?: boolean;
  className?: string;
}) {
  const bounds = piecesBounds([candidatePoints, referencePoints ?? candidatePoints]);
  return (
    <svg viewBox="0 0 100 100" className={cn("h-[72px] w-[72px] shrink-0", className)}>
      {referencePoints && (
        <path
          d={toSvgPath(referencePoints, bounds)}
          fill="none"
          className="stroke-foreground-muted/40"
          strokeWidth="1.5"
          strokeDasharray="3,2"
        />
      )}
      <path
        d={toSvgPath(candidatePoints, bounds)}
        className={cn(
          ok === false ? "fill-danger-soft stroke-danger" : ok === true ? "fill-success-soft stroke-success" : "fill-brand-soft stroke-brand"
        )}
        fillOpacity="0.6"
        strokeWidth="1.8"
      />
    </svg>
  );
}
