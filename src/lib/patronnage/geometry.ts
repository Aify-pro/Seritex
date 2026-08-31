export type Point = [number, number];

export interface ShapeGeometry {
  points: Point[];
  area: number;
  perimeter: number;
  radial: number[];
}

export interface ShapeComparison {
  confidence: number;
  areaDiffPct: number;
  perimDiffPct: number;
  shapeDiffPct: number;
}

export function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function polygonPerimeter(points: Point[]): number {
  let p = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

export function centroid(points: Point[]): Point {
  let cx = 0,
    cy = 0,
    a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a = a / 2;
  if (Math.abs(a) < 1e-9) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

// Angle de l'axe principal (ACP simplifiée par matrice de covariance)
export function principalAngle(points: Point[], c: Point): number {
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const [x, y] of points) {
    const dx = x - c[0],
      dy = y - c[1];
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

export function rotatePoint([x, y]: Point, angle: number): Point {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [x * cos + y * sin, -x * sin + y * cos];
}

// Échantillonne le contour à pas constant le long du périmètre
function sampleBoundary(points: Point[], n = 240): Point[] {
  const perim = polygonPerimeter(points);
  if (perim === 0) return new Array(n).fill(points[0] ?? [0, 0]);
  const step = perim / n;
  const samples: Point[] = [];
  let segIndex = 0;
  let cum = 0; // distance cumulée du début du contour jusqu'au début du segment courant
  let [x1, y1] = points[0];
  let [x2, y2] = points[1 % points.length];
  let segLen = Math.hypot(x2 - x1, y2 - y1);

  for (let k = 0; k < n; k++) {
    const targetDist = k * step;
    while (cum + segLen < targetDist && segIndex < points.length - 1) {
      cum += segLen;
      segIndex++;
      [x1, y1] = points[segIndex % points.length];
      [x2, y2] = points[(segIndex + 1) % points.length];
      segLen = Math.hypot(x2 - x1, y2 - y1);
    }
    const remaining = targetDist - cum;
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, remaining / segLen));
    samples.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return samples;
}

// Signature radiale : distance centroïde -> contour par secteur angulaire (24 secteurs)
function radialSignature(points: Point[], c: Point, angle: number, bins = 24): number[] {
  const buckets = new Array(bins).fill(0);
  const boundary = sampleBoundary(points, 360);
  for (const p of boundary) {
    const rp = rotatePoint([p[0] - c[0], p[1] - c[1]], angle);
    const theta = Math.atan2(rp[1], rp[0]);
    const bin = Math.min(bins - 1, Math.floor(((theta + Math.PI) / (2 * Math.PI)) * bins));
    const r = Math.hypot(rp[0], rp[1]);
    if (r > buckets[bin]) buckets[bin] = r;
  }
  return buckets;
}

/**
 * Normalisation : centrage + alignement d'axe, SANS mise à l'échelle.
 * L'échelle réelle est volontairement conservée : c'est elle qui distingue
 * les tailles entre elles (un S et un L ont la même silhouette normalisée
 * en position/rotation, mais une aire et un périmètre différents).
 */
export function normalizeShape(points: Point[]): ShapeGeometry {
  const c = centroid(points);
  const angle = principalAngle(points, c);
  const area = polygonArea(points);
  const perimeter = polygonPerimeter(points);
  const radial = radialSignature(points, c, angle);
  const rotated = points.map((p) => rotatePoint([p[0] - c[0], p[1] - c[1]], angle));
  return { points: rotated, area, perimeter, radial };
}

/**
 * Compare une forme candidate à une forme de référence déjà normalisée.
 * Score de confiance = 100 - moyenne pondérée des écarts (aire/périmètre/
 * signature radiale). Poids et seuils à recalibrer sur des cas réels (cf.
 * rapport du module).
 */
export function compareShapes(candidate: ShapeGeometry, reference: ShapeGeometry): ShapeComparison {
  const areaDiffPct = (Math.abs(candidate.area - reference.area) / reference.area) * 100;
  const perimDiffPct = (Math.abs(candidate.perimeter - reference.perimeter) / reference.perimeter) * 100;
  const meanR = reference.radial.reduce((s, v) => s + v, 0) / reference.radial.length;
  let sq = 0;
  for (let i = 0; i < reference.radial.length; i++) {
    const d = candidate.radial[i] - reference.radial[i];
    sq += d * d;
  }
  const rmse = Math.sqrt(sq / reference.radial.length);
  const shapeDiffPct = meanR > 0 ? (rmse / meanR) * 100 : 100;

  const confidence = Math.max(0, 100 - (0.5 * areaDiffPct + 0.2 * perimDiffPct + 0.3 * shapeDiffPct));

  return {
    confidence: Math.round(confidence * 10) / 10,
    areaDiffPct: Math.round(areaDiffPct * 10) / 10,
    perimDiffPct: Math.round(perimDiffPct * 10) / 10,
    shapeDiffPct: Math.round(shapeDiffPct * 10) / 10,
  };
}
