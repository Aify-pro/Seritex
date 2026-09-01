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
 *
 * Invariance en rotation : `normalizeShape` aligne chaque forme sur son
 * propre axe principal (ACP), mais cet axe est une droite, pas une
 * direction — il laisse une ambiguïté de 180° non résolue (une pièce et
 * cette même pièce tournée de 180° s'alignent sur le même axe mais avec
 * une signature radiale décalée d'un demi-tour). Sans correction, une
 * pièce correctement posée mais tournée sur le tracé pouvait être jugée
 * "non reconnue" à tort. On teste donc les deux décalages possibles de la
 * signature radiale (0 et un demi-tour) et on retient le meilleur.
 *
 * Score de confiance = 100 - moyenne pondérée des écarts (aire/périmètre/
 * signature radiale). Poids et seuils à recalibrer sur des cas réels (cf.
 * rapport du module).
 */
/* ============================================================
   Extensions — pré-passe d'échelle fichier + passe réflexion (miroir)
   ============================================================
   Voir module-patronnage-specification.md §7. Fonctions pures, écrites
   pour recevoir le format de points déjà utilisé ici ([number, number]),
   et la fonction de comparaison existante (compareShapes) déjà adaptée
   avec la correction d'ambiguïté à 180°.
============================================================ */

export const FACTEURS_ECHELLE = [0.01, 0.1, 1, 10, 100, 1000] as const;
export type FacteurEchelle = (typeof FACTEURS_ECHELLE)[number];

export interface ReferenceGeom {
  id: string;
  geom: ShapeGeometry;
}

function scaleContour(contour: Point[], f: number): Point[] {
  if (f === 1) return contour;
  return contour.map(([x, y]) => [x * f, y * f]);
}

/**
 * Réflexion d'un contour (miroir sur l'axe vertical) avec inversion du sens
 * de parcours, pour préserver l'orientation attendue par normalizeShape.
 */
export function mirrorContour(contour: Point[]): Point[] {
  return contour.map(([x, y]) => [-x, y] as Point).reverse();
}

export interface ResultatEchelle {
  facteur: FacteurEchelle;
  scoreGlobal: number;
  detailParFacteur: Record<string, number>;
}

/**
 * Détecte le facteur d'échelle du FICHIER ENTIER, avant toute comparaison
 * pièce-à-pièce. Étanche avec la détection de taille : les facteurs sont
 * espacés d'un ordre de grandeur (×10), largement hors de portée d'un écart
 * de gradation (~5-6 % par taille), qui reste détecté par compareShapes au
 * seuil normal. Stratégie en deux temps pour rester rapide :
 *  a) filtre grossier par aire (fenêtre ±15%, sert à départager des ordres
 *     de grandeur, pas des tailles) ;
 *  b) confirmation fine (compareShapes) sur un échantillon des plus grandes
 *     pièces candidates.
 * À égalité de score, le facteur 1 (aucune correction) l'emporte toujours.
 */
export function detecterEchelleFichier(
  pieces: Point[][],
  bibliotheque: ReferenceGeom[],
  seuil = 98,
  taillePreEchantillon = 8
): ResultatEchelle {
  const airesRef = bibliotheque.map((r) => ({ ref: r, aire: r.geom.area }));
  const geomsBrutes = pieces.map((p) => ({ points: p, aire: polygonArea(p) }));
  const detail: Record<string, number> = {};
  let meilleur: { facteur: FacteurEchelle; score: number } = { facteur: 1, score: -1 };

  for (const f of FACTEURS_ECHELLE) {
    const f2 = f * f;
    const candidatsParPiece = geomsBrutes.map(({ aire }) => {
      const aScaled = aire * f2;
      return airesRef.filter(({ aire: ar }) => aScaled >= ar * 0.85 && aScaled <= ar * 1.15);
    });
    const tauxCandidats = candidatsParPiece.filter((c) => c.length > 0).length / pieces.length;

    if (tauxCandidats < 0.3) {
      detail[String(f)] = 0;
      continue; // ordre de grandeur manifestement faux
    }

    const indices = geomsBrutes
      .map(({ aire }, i) => ({ aire, i }))
      .filter(({ i }) => candidatsParPiece[i].length > 0)
      .sort((x, y) => y.aire - x.aire)
      .slice(0, taillePreEchantillon)
      .map(({ i }) => i);

    let matches = 0;
    for (const i of indices) {
      const scaled = normalizeShape(scaleContour(pieces[i], f));
      const ok = candidatsParPiece[i].some(({ ref }) => compareShapes(scaled, ref.geom).confidence >= seuil);
      if (ok) matches++;
    }
    const score = indices.length > 0 ? matches / indices.length : 0;
    detail[String(f)] = score;

    if (score > meilleur.score || (score === meilleur.score && f === 1)) {
      meilleur = { facteur: f, score };
    }
  }

  return { facteur: meilleur.facteur, scoreGlobal: Math.max(meilleur.score, 0), detailParFacteur: detail };
}

/** Application unique du facteur retenu à l'ensemble des pièces du fichier. */
export function appliquerEchelleFichier(pieces: Point[][], facteur: FacteurEchelle): Point[][] {
  return facteur === 1 ? pieces : pieces.map((c) => scaleContour(c, facteur));
}

export interface ResultatMiroir {
  reconnu: boolean;
  reference?: ReferenceGeom;
  score?: number;
}

/**
 * À appeler pour toute pièce NON reconnue par la comparaison directe :
 * reteste son contour miroité contre la même bibliothèque. Si reconnue
 * ainsi, la pièce compte comme reconnue mais reste marquée « en miroir »
 * par l'appelant (alerte non bloquante, jamais masquée).
 */
export function testerEnMiroir(piece: Point[], bibliotheque: ReferenceGeom[], seuil = 98): ResultatMiroir {
  const miroir = normalizeShape(mirrorContour(piece));
  let best: { ref: ReferenceGeom; score: number } | null = null;
  for (const ref of bibliotheque) {
    const s = compareShapes(miroir, ref.geom).confidence;
    if (s >= seuil && (!best || s > best.score)) best = { ref, score: s };
  }
  return best ? { reconnu: true, reference: best.ref, score: best.score } : { reconnu: false };
}

/**
 * Compare une forme candidate à une forme de référence déjà normalisée.
 *
 * Invariance en rotation : `normalizeShape` aligne chaque forme sur son
 * propre axe principal (ACP), mais cet axe est une droite, pas une
 * direction — il laisse une ambiguïté de 180° non résolue (une pièce et
 * cette même pièce tournée de 180° s'alignent sur le même axe mais avec
 * une signature radiale décalée d'un demi-tour). Sans correction, une
 * pièce correctement posée mais tournée sur le tracé pouvait être jugée
 * "non reconnue" à tort. On teste donc les deux décalages possibles de la
 * signature radiale (0 et un demi-tour) et on retient le meilleur.
 *
 * Score de confiance = 100 - moyenne pondérée des écarts (aire/périmètre/
 * signature radiale). Poids et seuils à recalibrer sur des cas réels (cf.
 * rapport du module).
 */
export function compareShapes(candidate: ShapeGeometry, reference: ShapeGeometry): ShapeComparison {
  const areaDiffPct = (Math.abs(candidate.area - reference.area) / reference.area) * 100;
  const perimDiffPct = (Math.abs(candidate.perimeter - reference.perimeter) / reference.perimeter) * 100;
  const meanR = reference.radial.reduce((s, v) => s + v, 0) / reference.radial.length;

  const bins = reference.radial.length;
  const halfTurnShift = Math.round(bins / 2);
  const rmseAtShift = (shift: number) => {
    let sq = 0;
    for (let i = 0; i < bins; i++) {
      const d = candidate.radial[(i + shift) % bins] - reference.radial[i];
      sq += d * d;
    }
    return Math.sqrt(sq / bins);
  };
  const rmse = Math.min(rmseAtShift(0), rmseAtShift(halfTurnShift));
  const shapeDiffPct = meanR > 0 ? (rmse / meanR) * 100 : 100;

  const confidence = Math.max(0, 100 - (0.5 * areaDiffPct + 0.2 * perimDiffPct + 0.3 * shapeDiffPct));

  return {
    confidence: Math.round(confidence * 10) / 10,
    areaDiffPct: Math.round(areaDiffPct * 10) / 10,
    perimDiffPct: Math.round(perimDiffPct * 10) / 10,
    shapeDiffPct: Math.round(shapeDiffPct * 10) / 10,
  };
}
