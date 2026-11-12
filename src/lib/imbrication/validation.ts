/**
 * Contrôle INDÉPENDANT d'un tracé rendu par le moteur d'imbrication.
 *
 * Le moteur est réputé juste, mais un tracé faux coûte du tissu : Seritex
 * refait donc lui-même, avec sa propre géométrie (en double précision, sur
 * les contours d'origine), toutes les vérifications qui rendent un tracé
 * utilisable. Un tracé qui échoue ici ne doit JAMAIS être enregistré comme
 * valide.
 *
 *  1. chaque pièce est placée exactement le nombre de fois demandé ;
 *  2. chaque placement respecte les rotations autorisées et le retournement ;
 *  3. tout est dans la largeur utilisable (marges de lisière comprises) ;
 *  4. aucune pièce n'en chevauche une autre ;
 *  5. l'espacement demandé est respecté entre pièces.
 *
 * Tolérances : le moteur calcule en flottants 32 bits, d'où un bruit de
 * l'ordre du millième de millimètre. On ne signale donc un chevauchement
 * qu'au-delà de TOLERANCE_MM, et un espacement manquant qu'au-delà de
 * TOLERANCE_ESPACEMENT_MM — des écarts sans aucune portée physique à la coupe.
 *
 * Module sans dépendance serveur : utilisable dans les scripts de test et de
 * banc d'essai comme dans les actions serveur.
 */
import type { EntreeImbricationNormalisee, PieceImbrication, PlacementImbrication, SortieImbrication } from "./contrat";

export type Point = [number, number];

export const TOLERANCE_MM = 0.01;
export const TOLERANCE_ESPACEMENT_MM = 0.05;
const TOLERANCE_ANGLE_DEG = 1e-3;

export interface ProblemeTrace {
  code:
    | "statut"
    | "piece_inconnue"
    | "quantite"
    | "rotation"
    | "miroir"
    | "hors_largeur"
    | "hors_longueur"
    | "chevauchement"
    | "espacement";
  message: string;
  pieces?: string[];
}

export interface ResultatValidation {
  valide: boolean;
  problemes: ProblemeTrace[];
  /** Mesures recalculées par Seritex (font foi, pas celles du moteur). */
  longueurMm: number;
  tauxUtilisation: number;
  surfacePiecesMm2: number;
  /** Plus petite distance constatée entre deux pièces (mm), null si une seule pièce. */
  espacementMinMm: number | null;
}

// ---------------------------------------------------------------------------
// Géométrie élémentaire (double précision)
// ---------------------------------------------------------------------------

export function aireSignee(points: Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Même convention que le moteur : symétrie y → -y, rotation, translation. */
export function transformerContour(contour: Point[], p: Pick<PlacementImbrication, "x" | "y" | "rotation" | "miroir">): Point[] {
  const a = (p.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return contour.map(([x, y0]) => {
    const y = p.miroir ? -y0 : y0;
    return [x * c - y * s + p.x, x * s + y * c + p.y];
  });
}

/** Retire le dernier point s'il répète le premier (contour « fermé » à la DXF). */
export function ouvrirContour(contour: Point[]): Point[] {
  if (contour.length < 2) return contour;
  const [a, b] = [contour[0], contour[contour.length - 1]];
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 ? contour.slice(0, -1) : contour;
}

interface Boite {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boite(points: Point[]): Boite {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boitesProches(a: Boite, b: Boite, marge: number): boolean {
  return a.minX - marge <= b.maxX && b.minX - marge <= a.maxX && a.minY - marge <= b.maxY && b.minY - marge <= a.maxY;
}

/** Distance signée du point c à la droite (a, b) ; positive à gauche. */
function distanceSigneeDroite(a: Point, b: Point, c: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l === 0) return Math.hypot(c[0] - a[0], c[1] - a[1]);
  return (dx * (c[1] - a[1]) - dy * (c[0] - a[0])) / l;
}

function distancePointSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Deux segments se croisent-ils FRANCHEMENT ? Chaque extrémité doit être à
 * plus de `tol` de l'autre droite, de part et d'autre : deux bords qui se
 * touchent (cas normal sans espacement) ne comptent pas.
 */
function croisementFranc(a1: Point, a2: Point, b1: Point, b2: Point, tol: number): boolean {
  const d1 = distanceSigneeDroite(a1, a2, b1);
  const d2 = distanceSigneeDroite(a1, a2, b2);
  if (!((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol))) return false;
  const d3 = distanceSigneeDroite(b1, b2, a1);
  const d4 = distanceSigneeDroite(b1, b2, a2);
  return (d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol);
}

function distanceSegments(a1: Point, a2: Point, b1: Point, b2: Point): number {
  return Math.min(
    distancePointSegment(a1, b1, b2),
    distancePointSegment(a2, b1, b2),
    distancePointSegment(b1, a1, a2),
    distancePointSegment(b2, a1, a2)
  );
}

function pointDansPolygone([x, y]: Point, poly: Point[]): boolean {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function distancePointContour(p: Point, poly: Point[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distancePointSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/**
 * Relation entre deux pièces posées : `chevauchement` si elles se
 * superposent au-delà de la tolérance, sinon la distance entre leurs bords.
 */
function relation(a: Point[], b: Point[], tol: number, distanceUtile: number): { chevauchement: true } | { chevauchement: false; distance: number } {
  let distance = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    const ba = boite([a1, a2]);
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      // Segments trop éloignés pour compter : on saute le calcul exact.
      if (!boitesProches(ba, boite([b1, b2]), distanceUtile)) continue;
      if (croisementFranc(a1, a2, b1, b2, tol)) return { chevauchement: true };
      distance = Math.min(distance, distanceSegments(a1, a2, b1, b2));
    }
  }
  // Aucun bord ne se croise : une pièce peut encore être entièrement dans
  // l'autre. On teste tous les sommets (un sommet posé pile sur le bord de
  // l'autre pièce ne suffit pas à conclure).
  if (contientUnSommet(b, a, tol) || contientUnSommet(a, b, tol)) return { chevauchement: true };
  return { chevauchement: false, distance };
}

/** Un sommet de `p` est-il franchement à l'intérieur de `poly` ? */
function contientUnSommet(poly: Point[], p: Point[], tol: number): boolean {
  const b = boite(poly);
  return p.some(
    (s) =>
      s[0] > b.minX && s[0] < b.maxX && s[1] > b.minY && s[1] < b.maxY && pointDansPolygone(s, poly) && distancePointContour(s, poly) > tol
  );
}

function angleAutorise(rotation: number, autorises: number[]): boolean {
  const r = ((rotation % 360) + 360) % 360;
  return autorises.some((a) => {
    const n = ((a % 360) + 360) % 360;
    const d = Math.abs(r - n);
    return Math.min(d, 360 - d) <= TOLERANCE_ANGLE_DEG;
  });
}

// ---------------------------------------------------------------------------
// Contrôle des contours en entrée
// ---------------------------------------------------------------------------

export interface ProblemeContour {
  pieceId: string;
  message: string;
}

/**
 * Contour utilisable par le moteur : au moins 3 points distincts, une
 * surface, et aucun bord qui en croise un autre (contour « en huit »). À
 * appeler avant d'envoyer des pièces au moteur, avec des messages qui
 * nomment la pièce.
 */
export function controlerContours(pieces: Pick<PieceImbrication, "id" | "contour">[]): ProblemeContour[] {
  const problemes: ProblemeContour[] = [];
  for (const piece of pieces) {
    const c = ouvrirContour(piece.contour as Point[]);
    if (c.length < 3) {
      problemes.push({ pieceId: piece.id, message: `La pièce « ${piece.id} » a moins de 3 points : ce n'est pas un contour.` });
      continue;
    }
    if (Math.abs(aireSignee(c)) < 1e-6) {
      problemes.push({ pieceId: piece.id, message: `Le contour de la pièce « ${piece.id} » n'a pas de surface.` });
      continue;
    }
    let croise = false;
    for (let i = 0; i < c.length && !croise; i++) {
      for (let j = i + 2; j < c.length && !croise; j++) {
        if (i === 0 && j === c.length - 1) continue; // segments voisins (fermeture)
        if (croisementFranc(c[i], c[(i + 1) % c.length], c[j], c[(j + 1) % c.length], 0)) croise = true;
      }
    }
    if (croise) {
      problemes.push({
        pieceId: piece.id,
        message: `Le contour de la pièce « ${piece.id} » se croise lui-même : vérifiez le patron (ligne de coupe en huit ou points dans le désordre).`,
      });
    }
  }
  return problemes;
}

// ---------------------------------------------------------------------------
// Validation d'un tracé
// ---------------------------------------------------------------------------

export function validerTrace(entree: EntreeImbricationNormalisee, sortie: SortieImbrication): ResultatValidation {
  const problemes: ProblemeTrace[] = [];
  const vide = { longueurMm: 0, tauxUtilisation: 0, surfacePiecesMm2: 0, espacementMinMm: null };
  if (sortie.statut === "echec") {
    return {
      valide: false,
      problemes: [{ code: "statut", message: sortie.erreur?.message ?? "Le moteur n'a pas produit de tracé." }],
      ...vide,
    };
  }

  const pieces = new Map(entree.pieces.map((p) => [p.id, { ...p, contour: ouvrirContour(p.contour as Point[]) }]));
  const { largeur_utile: largeur, marge_lisiere: marge } = entree.tissu;

  // 1. Quantités
  const comptes = new Map<string, number>();
  for (const pl of sortie.placements) {
    if (!pieces.has(pl.piece_id)) {
      problemes.push({ code: "piece_inconnue", message: `Le tracé contient une pièce inconnue (« ${pl.piece_id} »).`, pieces: [pl.piece_id] });
      continue;
    }
    comptes.set(pl.piece_id, (comptes.get(pl.piece_id) ?? 0) + 1);
  }
  for (const p of pieces.values()) {
    const n = comptes.get(p.id) ?? 0;
    if (n !== p.quantite) {
      problemes.push({
        code: "quantite",
        message: `Pièce « ${p.id} » : ${n} placée(s) au lieu de ${p.quantite}.`,
        pieces: [p.id],
      });
    }
  }

  // 2 et 3. Orientation et limites du tissu
  const posees: { id: string; contour: Point[]; boite: Boite }[] = [];
  let surface = 0;
  let longueur = 0;
  for (const pl of sortie.placements) {
    const piece = pieces.get(pl.piece_id);
    if (!piece) continue;
    if (!angleAutorise(pl.rotation, piece.rotations)) {
      problemes.push({
        code: "rotation",
        message: `Pièce « ${piece.id} » tournée de ${Math.round(pl.rotation)}°, angle non autorisé (${piece.rotations.join(", ")}°).`,
        pieces: [piece.id],
      });
    }
    if (pl.miroir !== piece.miroir) {
      problemes.push({
        code: "miroir",
        message: `Pièce « ${piece.id} » ${pl.miroir ? "retournée alors qu'elle ne doit pas l'être" : "non retournée alors qu'elle doit l'être"}.`,
        pieces: [piece.id],
      });
    }
    const contour = transformerContour(piece.contour, pl);
    const b = boite(contour);
    if (b.minY < marge - TOLERANCE_MM || b.maxY > largeur - marge + TOLERANCE_MM) {
      problemes.push({
        code: "hors_largeur",
        message: `Pièce « ${piece.id} » hors de la largeur utilisable du tissu.`,
        pieces: [piece.id],
      });
    }
    if (b.minX < -TOLERANCE_MM) {
      problemes.push({ code: "hors_longueur", message: `Pièce « ${piece.id} » avant le début du tracé.`, pieces: [piece.id] });
    }
    longueur = Math.max(longueur, b.maxX);
    surface += Math.abs(aireSignee(piece.contour));
    posees.push({ id: piece.id, contour, boite: b });
  }

  // 4 et 5. Chevauchements et espacement
  const espacement = entree.espacement;
  const distanceUtile = Math.max(espacement, TOLERANCE_MM) + 1;
  let espacementMin: number | null = null;
  const ordre = posees.map((_, i) => i).sort((i, j) => posees[i].boite.minX - posees[j].boite.minX);
  for (let oi = 0; oi < ordre.length; oi++) {
    const a = posees[ordre[oi]];
    for (let oj = oi + 1; oj < ordre.length; oj++) {
      const b = posees[ordre[oj]];
      // Triées par X : au-delà de cette pièce, plus aucune n'est assez proche.
      if (b.boite.minX - distanceUtile > a.boite.maxX) break;
      if (!boitesProches(a.boite, b.boite, distanceUtile)) continue;
      const r = relation(a.contour, b.contour, TOLERANCE_MM, distanceUtile);
      if (r.chevauchement) {
        problemes.push({
          code: "chevauchement",
          message: `Les pièces « ${a.id} » et « ${b.id} » se chevauchent.`,
          pieces: [a.id, b.id],
        });
        continue;
      }
      if (Number.isFinite(r.distance)) {
        espacementMin = espacementMin === null ? r.distance : Math.min(espacementMin, r.distance);
        if (espacement > 0 && r.distance < espacement - TOLERANCE_ESPACEMENT_MM) {
          problemes.push({
            code: "espacement",
            message: `Les pièces « ${a.id} » et « ${b.id} » ne sont qu'à ${r.distance.toFixed(2)} mm l'une de l'autre (minimum demandé : ${espacement} mm).`,
            pieces: [a.id, b.id],
          });
        }
      }
    }
  }

  return {
    valide: problemes.length === 0,
    problemes,
    longueurMm: longueur,
    tauxUtilisation: longueur > 0 ? surface / (longueur * largeur) : 0,
    surfacePiecesMm2: surface,
    espacementMinMm: espacementMin,
  };
}
