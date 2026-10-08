/**
 * Dimensions des films (lot 2) : zone du visuel à relire et taille à laquelle
 * la relire pour la résolution visée. Module léger, sans pdf-lib, utilisable
 * à l'affichage.
 */
import { HORS_DESSIN, type ResultatSeparation } from "./separer";

/** Résolution visée des films (points par pouce). */
export const PPP_FILMS = 360;
/** Pixels au plus pour la zone relue : au-delà, la mémoire du navigateur sature. */
export const PIXELS_MAX = 24_000_000;
/** Marge relue autour du dessin (fraction de sa taille), recadrée ensuite. */
const MARGE = 0.02;

export type Zone = { x: number; y: number; l: number; h: number };

/** Cadre du dessin dans l'image d'analyse, en fractions de l'image. */
function cadre(r: ResultatSeparation): Zone {
  let x0 = r.largeur;
  let x1 = -1;
  let y0 = r.hauteur;
  let y1 = -1;
  for (let p = 0; p < r.indices.length; p++) {
    if (r.indices[p] === HORS_DESSIN) continue;
    const x = p % r.largeur;
    const y = (p - x) / r.largeur;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0 / r.largeur, y: y0 / r.hauteur, l: (x1 - x0 + 1) / r.largeur, h: (y1 - y0 + 1) / r.hauteur };
}

/**
 * Zone à relire (dessin + petite marge, en fractions de l'image), taille de
 * relecture en pixels, résolution obtenue et hauteur imprimée.
 */
export function dimensionsFilms(r: ResultatSeparation, largeurCm: number) {
  const c = cadre(r);
  const ratio = (c.h * r.hauteur) / (c.l * r.largeur);
  const pouces = largeurCm / 2.54;
  let lpx = pouces * PPP_FILMS;
  const reduction = Math.min(1, Math.sqrt(PIXELS_MAX / (lpx * lpx * ratio * (1 + 2 * MARGE) ** 2)));
  lpx *= reduction;
  const zone: Zone = {
    x: Math.max(0, c.x - c.l * MARGE),
    y: Math.max(0, c.y - c.h * MARGE),
    l: Math.min(1, c.l * (1 + 2 * MARGE)),
    h: Math.min(1, c.h * (1 + 2 * MARGE)),
  };
  zone.l = Math.min(zone.l, 1 - zone.x);
  zone.h = Math.min(zone.h, 1 - zone.y);
  return {
    zone,
    largeurPx: Math.max(1, Math.round((lpx * zone.l) / c.l)),
    hauteurPx: Math.max(1, Math.round((lpx * ratio * zone.h) / c.h)),
    ppp: Math.round(lpx / pouces),
    hauteurCm: largeurCm * ratio,
  };
}

/**
 * Surface imprimée par pièce de chaque couleur (cm²) quand le dessin mesure
 * `largeurCm` de large, et surface totale du dessin (sous-couche).
 */
export function surfacesCm2(r: ResultatSeparation, largeurCm: number) {
  const c = cadre(r);
  const cadrePx = c.l * r.largeur * c.h * r.hauteur;
  const hauteurCm = (largeurCm * (c.h * r.hauteur)) / (c.l * r.largeur);
  const cm2ParPx = (largeurCm * hauteurCm) / Math.max(1, cadrePx);
  const comptes = new Array<number>(r.couleurs.length).fill(0);
  for (let p = 0; p < r.indices.length; p++) {
    const k = r.indices[p];
    if (k !== HORS_DESSIN) comptes[k] += 1;
  }
  const couleurs = comptes.map((n) => n * cm2ParPx);
  return { couleurs, dessin: couleurs.reduce((s, v) => s + v, 0) };
}
