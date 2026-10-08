/**
 * Séparation des couleurs d'un visuel pour la sérigraphie, avec le moteur
 * Reveal (reveal-core.js, licence Apache 2.0).
 *
 * Le moteur réduit l'image à quelques couleurs en espace Lab (perceptuel) ;
 * cette couche décide ensuite lesquelles sont de VRAIES encres :
 *  - le fond uni ou transparent n'est pas imprimé ;
 *  - les nuances de bord (anticrénelage, bruit JPEG) ne forment pas d'aplat et
 *    sont souvent des mélanges de deux couleurs voisines : elles rejoignent la
 *    couleur la plus proche ;
 *  - une couleur qui couvre moins de 0,5 % du dessin est rattachée de même.
 *
 * Fonction pure (pas de DOM) : appelée par le Web Worker du navigateur et par
 * le banc de test Node (npm run test:separation). Le même fichier est copié
 * dans le dépôt du site (www.seritex.ci) pour l'e-shop.
 */

/** Sous-ensemble du moteur Reveal utilisé ici (module généré, non typé). */
export interface RevealCore {
  LabEncoding: { rgbToLab(rgb: { r: number; g: number; b: number }): { L: number; a: number; b: number } };
  BilateralFilter: { applyBilateralFilterLab(lab: Uint16Array, w: number, h: number, rayon: number, sigma: number): void };
  DNAGenerator: { fromPixels(lab: Uint16Array, w: number, h: number, o: { bitDepth: number }): unknown };
  ParameterGenerator: { toEngineOptions(config: unknown, o: { bitDepth: number }): Record<string, unknown> };
  generateConfigurationMk2(dna: unknown): Record<string, unknown>;
  posterizeImage(
    lab: Uint16Array,
    w: number,
    h: number,
    n: number,
    params: Record<string, unknown>,
  ): Promise<{ paletteLab: { L: number; a: number; b: number }[]; palette: { r: number; g: number; b: number }[] }>;
}

export type CouleurSeparee = {
  hex: string;
  /** Part du dessin couverte par cette couleur (0 à 1). */
  part: number;
};

export type ResultatSeparation = {
  largeur: number;
  hauteur: number;
  /** Couleurs à imprimer, de la plus présente à la moins présente. */
  couleurs: CouleurSeparee[];
  /** Pour chaque pixel : index dans `couleurs`, ou HORS_DESSIN (fond, transparence). */
  indices: Uint8Array;
  /** Image transparente (au moins 3 % de pixels transparents). */
  transparent: boolean;
  /** Fond uni détecté et retiré (non imprimé), ou null. */
  fond: string | null;
  /** Dégradé ou photo : les couleurs proposées sont une simplification. */
  degrade: boolean;
};

export type OptionsSeparation = {
  /**
   * Nombre de couleurs imposé (1 à 12). Sans valeur, le moteur détermine
   * lui-même le nombre d'encres nécessaires.
   */
  nbCouleurs?: number;
};

export const HORS_DESSIN = 255;

const PART_MIN = 0.005;
/** Distance RVB sous laquelle une couleur est considérée comme un mélange de deux autres. */
const SEUIL_MELANGE = 22;
/** Part de pixels « pleins » (entourés de la même couleur) au-delà de laquelle un mélange est un vrai aplat. */
const SEUIL_PLEIN = 0.35;
/** En dessous, la couleur ne forme aucun aplat : c'est un liseré de bord, même si ce n'est pas un mélange net. */
const SEUIL_LISERE = 0.1;
/** Écart moyen (ΔE) entre le visuel et sa version séparée au-delà duquel c'est une photo. */
const SEUIL_PHOTO = 10;
/** Distance RVB sous laquelle deux pixels voisins (à 2 px) sont dans une zone lisse. */
const SEUIL_LISSE = 30;
/** Part de frontières entre couleurs tracées dans une zone lisse au-delà de laquelle c'est un dégradé. */
const SEUIL_FRONTIERES = 0.3;
/** Nombre minimal de frontières lisses, rapporté aux pixels du dessin. */
const LISSES_MIN = 0.002;
/** Pixels confiés au moteur pour trouver la palette (échantillon régulier). */
const ECHANTILLON_MAX = 60_000;

type Vec = [number, number, number];

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Distance du point c au segment [a, b]. */
function distanceSegment(c: Vec, a: Vec, b: Vec) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / l2));
  return distance(c, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]);
}

export const versHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/**
 * Sépare les couleurs d'une image RVBA (Canvas ImageData ou équivalent).
 * Prévoir une image de 600 à 1000 px de côté : au-delà, le calcul est plus
 * long sans changer les couleurs trouvées.
 */
export async function separer(
  reveal: RevealCore,
  px: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  options: OptionsSeparation = {},
): Promise<ResultatSeparation> {
  const n = w * h;

  // 1. Fond : transparence, sinon quatre coins de même couleur.
  let transparents = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 16) transparents += 1;
  const transparent = transparents / n > 0.03;
  let fond: Vec | null = null;
  if (!transparent) {
    const coin = (x: number, y: number): Vec => {
      const i = (y * w + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    const coins = [coin(0, 0), coin(w - 1, 0), coin(0, h - 1), coin(w - 1, h - 1)];
    if (coins.every((c) => distance(c, coins[0]) < 30)) fond = coins[0];
  }
  // Couleur avec laquelle les bords du dessin se mélangent.
  const base: Vec = fond ?? [255, 255, 255];

  // 2. Conversion en Lab 16 bits (codage du moteur), transparence aplatie sur blanc.
  const lab = new Uint16Array(n * 3);
  const dessin = new Uint8Array(n);
  const cache = new Map<number, Vec>();
  let m = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const a = px[i + 3] / 255;
    const r = Math.round(px[i] * a + 255 * (1 - a));
    const g = Math.round(px[i + 1] * a + 255 * (1 - a));
    const b = Math.round(px[i + 2] * a + 255 * (1 - a));
    // Conversion mise en cache : un visuel compte bien moins de teintes que de pixels.
    const cle = (r << 16) | (g << 8) | b;
    let c = cache.get(cle);
    if (!c) {
      const v = reveal.LabEncoding.rgbToLab({ r, g, b });
      c = [Math.round((v.L / 100) * 32768), Math.round(v.a * 128 + 16384), Math.round(v.b * 128 + 16384)];
      cache.set(cle, c);
    }
    lab[p * 3] = c[0];
    lab[p * 3 + 1] = c[1];
    lab[p * 3 + 2] = c[2];
    if (px[i + 3] >= 128 && !(fond && distance([px[i], px[i + 1], px[i + 2]], fond) < 40)) {
      dessin[p] = 1;
      m += 1;
    }
  }
  if (m === 0) throw new Error("dessin vide");

  // 3. Lissage qui préserve les bords (atténue le bruit JPEG), puis réduction
  //    des couleurs sur un échantillon régulier des pixels du dessin : la
  //    palette est la même, le calcul bien plus court.
  reveal.BilateralFilter.applyBilateralFilterLab(lab, w, h, 3, 5000);
  const pas = Math.max(1, Math.ceil(m / ECHANTILLON_MAX));
  const ne = Math.ceil(m / pas);
  const pixelsDessin = new Uint16Array(ne * 3);
  for (let p = 0, j = 0, k = 0; p < n; p++) {
    if (!dessin[p]) continue;
    if (j++ % pas) continue;
    pixelsDessin[k++] = lab[p * 3];
    pixelsDessin[k++] = lab[p * 3 + 1];
    pixelsDessin[k++] = lab[p * 3 + 2];
  }
  const dna = reveal.DNAGenerator.fromPixels(pixelsDessin, ne, 1, { bitDepth: 16 });
  const config = reveal.generateConfigurationMk2(dna);
  const impose = options.nbCouleurs ? Math.max(1, Math.min(12, Math.round(options.nbCouleurs))) : null;
  if (impose) {
    // Marge : le moteur fusionne ensuite les couleurs trop proches.
    config.targetColors = impose + 2;
    config.targetColorsSlider = impose + 2;
  }
  const params: Record<string, unknown> = {
    ...reveal.ParameterGenerator.toEngineOptions(config, { bitDepth: 16 }),
    format: "lab",
    bitDepth: 16,
    snapThreshold: 0,
    densityFloor: 0,
    preservedUnifyThreshold: 0.5,
  };
  const cible = (params.targetColorsSlider ?? params.targetColors) as number;
  const res = await reveal.posterizeImage(pixelsDessin, ne, 1, cible, params);
  const palLab: Vec[] = res.paletteLab.map((c) => [c.L, c.a, c.b]);
  const palRgb: Vec[] = res.palette.map((c) => [c.r, c.g, c.b]);
  const P = palLab.length;

  // 4. Chaque pixel du dessin vers la couleur la plus proche (ΔE76).
  const brut = new Uint8Array(n).fill(HORS_DESSIN);
  const ecarts = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    if (!dessin[p]) continue;
    const c: Vec = [lab[p * 3] / 327.68, (lab[p * 3 + 1] - 16384) / 128, (lab[p * 3 + 2] - 16384) / 128];
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < P; k++) {
      const d = distance(c, palLab[k]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    brut[p] = best;
    ecarts[p] = bestD;
  }

  // 5. Couverture et pixels « pleins » (les 8 voisins de la même couleur).
  const total = new Array<number>(P).fill(0);
  const pleins = new Array<number>(P).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const c = brut[p];
      if (c === HORS_DESSIN) continue;
      total[c] += 1;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      let plein = true;
      for (let dy = -1; dy <= 1 && plein; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (brut[p + dy * w + dx] !== c) {
            plein = false;
            break;
          }
        }
      }
      if (plein) pleins[c] += 1;
    }
  }

  // 6. Tri des vraies encres, de la plus présente à la moins présente.
  const ordre = [...Array(P).keys()].sort((a, b) => total[b] - total[a]);
  let gardes: number[] = [];
  for (const k of ordre) {
    if (total[k] / m < PART_MIN) continue;
    if ((fond || transparent) && distance(palRgb[k], base) < 30) continue;
    const refs = [...gardes.map((g) => palRgb[g]), base];
    let melange = false;
    for (let a = 0; a < refs.length && !melange; a++) {
      for (let b = a + 1; b < refs.length; b++) {
        if (distanceSegment(palRgb[k], refs[a], refs[b]) < SEUIL_MELANGE) {
          melange = true;
          break;
        }
      }
    }
    const plein = pleins[k] / Math.max(1, total[k]);
    // Nombre imposé : on garde les mélanges (photos, dégradés), seul le nombre compte.
    if (!impose && (plein < SEUIL_LISERE || (melange && plein < SEUIL_PLEIN))) continue;
    gardes.push(k);
  }
  if (gardes.length === 0) gardes = [ordre[0]];

  // 7. Nombre imposé : fusion des moins présentes dans leur plus proche voisine.
  const versGarde = (k: number, liste: number[]) =>
    liste.reduce((best, g) => (distance(palLab[k], palLab[g]) < distance(palLab[k], palLab[best]) ? g : best), liste[0]);
  if (impose && gardes.length > impose) {
    const parts = new Map(gardes.map((g) => [g, 0]));
    for (let k = 0; k < P; k++) parts.set(versGarde(k, gardes), parts.get(versGarde(k, gardes))! + total[k]);
    gardes = [...gardes].sort((a, b) => parts.get(b)! - parts.get(a)!).slice(0, impose);
  }

  // 8. Indices finaux et parts. Un pixel de bord (couleur écartée) rejoint la
  //    plus proche des encres présentes autour de lui (5 × 5) : un liseré
  //    bleu nuit / blanc revient au bleu nuit, jamais à une autre encre du
  //    visuel qui ne le touche pas. Sans encre voisine : la plus proche.
  const correspondance = new Uint8Array(P);
  for (let k = 0; k < P; k++) correspondance[k] = versGarde(k, gardes);
  const estGarde = new Uint8Array(P);
  for (const g of gardes) estGarde[g] = 1;
  const choix = new Uint8Array(n).fill(HORS_DESSIN);
  const comptes = new Map(gardes.map((g) => [g, 0]));
  let ecartTotal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const c = brut[p];
      if (c === HORS_DESSIN) continue;
      let g = correspondance[c];
      if (!estGarde[c]) {
        const pix: Vec = [lab[p * 3] / 327.68, (lab[p * 3 + 1] - 16384) / 128, (lab[p * 3 + 2] - 16384) / 128];
        let bestD = Infinity;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            const v = brut[yy * w + xx];
            if (v === HORS_DESSIN || !estGarde[v]) continue;
            const voisine = correspondance[v];
            const d = distance(pix, palLab[voisine]);
            if (d < bestD) {
              bestD = d;
              g = voisine;
            }
          }
        }
      }
      choix[p] = g;
      comptes.set(g, comptes.get(g)! + 1);
      ecartTotal += ecarts[p];
    }
  }
  const finales = [...gardes].sort((a, b) => comptes.get(b)! - comptes.get(a)!);
  const rang = new Map(finales.map((g, i) => [g, i]));
  const indices = new Uint8Array(n);
  for (let p = 0; p < n; p++) indices[p] = choix[p] === HORS_DESSIN ? HORS_DESSIN : rang.get(choix[p])!;

  // 9. Dégradé : dans un logo, deux couleurs se touchent sur un bord net ; dans
  //    un dégradé ou une photo, la séparation coupe des zones où le visuel
  //    d'origine est lisse (frontières « artificielles »).
  let frontieres = 0;
  let lisses = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (indices[p] === HORS_DESSIN) continue;
      for (const q of [x + 2 < w ? p + 2 : -1, y + 2 < h ? p + 2 * w : -1]) {
        if (q < 0 || indices[q] === HORS_DESSIN || indices[q] === indices[p]) continue;
        frontieres += 1;
        if (distance([px[p * 4], px[p * 4 + 1], px[p * 4 + 2]], [px[q * 4], px[q * 4 + 1], px[q * 4 + 2]]) < SEUIL_LISSE) lisses += 1;
      }
    }
  }

  return {
    largeur: w,
    hauteur: h,
    couleurs: finales.map((g) => ({ hex: versHex(...palRgb[g]), part: comptes.get(g)! / m })),
    indices,
    transparent,
    fond: fond ? versHex(...fond) : null,
    // Écart moyen élevé : photo ou dessin trop riche pour quelques encres.
    // Frontières lisses : en proportion ET en nombre (deux couleurs qui se
    // touchent à peine ne font pas un dégradé).
    degrade: (lisses > SEUIL_FRONTIERES * frontieres && lisses > LISSES_MIN * m) || ecartTotal / m > SEUIL_PHOTO,
  };
}

/* ------------------------------------------------------------------------ */
/* Films : encres appliquées en pleine résolution                           */
/* ------------------------------------------------------------------------ */

/**
 * Îlots trop petits pour être imprimés (artefacts JPEG au bord d'une forme) :
 * toute zone d'une même valeur (encre ou fond, voisinage 4) de moins de
 * `pixelsMin` pixels prend la valeur la plus fréquente sur son pourtour.
 */
function sansIlots(v: Uint8Array, w: number, h: number, pixelsMin: number): Uint8Array {
  const out = v.slice();
  if (pixelsMin <= 1) return out;
  const vu = new Uint8Array(v.length);
  const pile = new Int32Array(v.length);
  const zone: number[] = [];
  const bord = new Uint32Array(256);
  for (let depart = 0; depart < v.length; depart++) {
    if (vu[depart]) continue;
    const c = v[depart];
    let haut = 0;
    pile[haut++] = depart;
    vu[depart] = 1;
    zone.length = 0;
    bord.fill(0);
    // Grande zone : on la parcourt pour la marquer, sans retenir ses pixels.
    let grand = false;
    while (haut > 0) {
      const p = pile[--haut];
      if (!grand) zone.push(p);
      if (zone.length >= pixelsMin) grand = true;
      const x = p % w;
      for (let j = 0; j < 4; j++) {
        const q = j === 0 ? (x > 0 ? p - 1 : -1) : j === 1 ? (x < w - 1 ? p + 1 : -1) : j === 2 ? p - w : p + w;
        if (q < 0 || q >= v.length) continue;
        if (v[q] !== c) {
          bord[v[q]] += 1;
          continue;
        }
        if (vu[q]) continue;
        vu[q] = 1;
        pile[haut++] = q;
      }
    }
    if (grand) continue;
    let best = -1;
    for (let k = 0; k < 256; k++) if (bord[k] && (best < 0 || bord[k] > bord[best])) best = k;
    if (best >= 0) for (const p of zone) out[p] = best;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

export type Films = {
  largeur: number;
  hauteur: number;
  /** Pour chaque pixel du cadrage : index de l'encre ou HORS_DESSIN. */
  indices: Uint8Array;
  /** Sous-couche blanche (1 = blanc déposé), si demandée. */
  sousCouche?: Uint8Array;
};

/** Côté de la table de correspondance (RVB quantifié sur 6 bits par canal). */
const Q = 64;

/**
 * Applique des encres déjà choisies (séparation à 700 px) à une image en
 * pleine résolution, puis recadre sur le dessin.
 *
 * Un pixel est vu comme le mélange de deux « couleurs pures » (deux encres, ou
 * une encre et le fond) : on retient la paire qui l'explique le mieux et on
 * tranche à 50 %, comme une flasheuse sur un bord lissé. Un liseré bleu nuit
 * sur fond blanc revient donc au bleu nuit ou au fond, jamais à une autre
 * encre. Une image transparente est tranchée à 50 % d'opacité.
 */
export function appliquerEncres(
  px: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  encres: string[],
  fond: string | null,
  transparent: boolean,
  /** Îlots plus petits (en pixels) retirés : ce qu'un écran ne sait pas imprimer. */
  pixelsMin = 4,
  /** Rentré de la sous-couche en pixels ; null = pas de sous-couche. */
  rentreSousCouchePx: number | null = null,
): Films {
  const rgb = (hex: string): Vec => {
    const v = Number.parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const purs: Vec[] = encres.map(rgb);
  // Le fond (non imprimé) participe aux mélanges des bords.
  const indexFond = purs.length;
  const avecFond = !!fond || transparent;
  if (avecFond) purs.push(fond ? rgb(fond) : [255, 255, 255]);

  const table = new Uint8Array(Q * Q * Q).fill(254);
  const choisir = (c: Vec) => {
    let best = 0;
    let bestD = Infinity;
    let bestT = 0;
    let bestA = 0;
    let bestB = 0;
    // Une seule couleur pure.
    for (let a = 0; a < purs.length; a++) {
      const d = distance(c, purs[a]);
      if (d < bestD) {
        bestD = d;
        best = a;
        bestA = -1;
      }
    }
    // Mélange de deux couleurs pures : seulement s'il explique nettement mieux.
    for (let a = 0; a < purs.length; a++) {
      for (let b = a + 1; b < purs.length; b++) {
        const A = purs[a];
        const B = purs[b];
        const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((c[0] - A[0]) * ab[0] + (c[1] - A[1]) * ab[1] + (c[2] - A[2]) * ab[2]) / l2));
        const d = distance(c, [A[0] + t * ab[0], A[1] + t * ab[1], A[2] + t * ab[2]]);
        if (d + 4 < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
          bestT = t;
        }
      }
    }
    if (bestA >= 0) best = bestT < 0.5 ? bestA : bestB;
    return best === indexFond && avecFond ? HORS_DESSIN : best;
  };

  const n = w * h;
  const brut = new Uint8Array(n);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const i = p * 4;
      if (transparent && px[i + 3] < 128) {
        brut[p] = HORS_DESSIN;
        continue;
      }
      const cle = ((px[i] >> 2) * Q + (px[i + 1] >> 2)) * Q + (px[i + 2] >> 2);
      let k = table[cle];
      if (k === 254) {
        k = choisir([(px[i] & 0xfc) + 2, (px[i + 1] & 0xfc) + 2, (px[i + 2] & 0xfc) + 2]);
        table[cle] = k;
      }
      brut[p] = k;
      if (k !== HORS_DESSIN) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("dessin vide");

  const lw = x1 - x0 + 1;
  const lh = y1 - y0 + 1;
  const indices = new Uint8Array(lw * lh);
  for (let y = 0; y < lh; y++) indices.set(brut.subarray((y + y0) * w + x0, (y + y0) * w + x0 + lw), y * lw);
  const films: Films = { largeur: lw, hauteur: lh, indices: sansIlots(indices, lw, lh, pixelsMin) };
  if (rentreSousCouchePx !== null) films.sousCouche = sousCouche(films, rentreSousCouchePx);
  return films;
}

/**
 * Sous-couche blanche (lot 3) : 1 là où une encre est déposée, rentré de
 * `rentrePx` pixels pour que le blanc ne déborde pas des couleurs au calage.
 * Distance au bord par chanfrein 3-4 (deux passes), en pixels.
 */
export function sousCouche(f: Films, rentrePx: number): Uint8Array {
  const { largeur: w, hauteur: h, indices } = f;
  // Distances plafonnées à 255 (octets) : seul compte le dépassement du seuil.
  const seuil = Math.min(250, Math.max(1, Math.round(rentrePx)) * 3);
  const d = new Uint8Array(w * h);
  for (let p = 0; p < d.length; p++) d[p] = indices[p] === HORS_DESSIN ? 0 : 255;
  const m = (a: number, b: number) => (b < a ? b : a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!d[p]) continue;
      // Hors de l'image = hors du dessin : le bord du cadrage compte comme un bord.
      let v = m(d[p], m(x > 0 ? d[p - 1] + 3 : 3, y > 0 ? d[p - w] + 3 : 3));
      if (x > 0 && y > 0) v = m(v, d[p - w - 1] + 4);
      if (x < w - 1 && y > 0) v = m(v, d[p - w + 1] + 4);
      d[p] = v > 255 ? 255 : v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = m(d[p], m(x < w - 1 ? d[p + 1] + 3 : 3, y < h - 1 ? d[p + w] + 3 : 3));
      if (x < w - 1 && y < h - 1) v = m(v, d[p + w + 1] + 4);
      if (x > 0 && y < h - 1) v = m(v, d[p + w - 1] + 4);
      d[p] = v > 255 ? 255 : v;
    }
  }
  for (let p = 0; p < d.length; p++) d[p] = d[p] > seuil ? 1 : 0;
  return d;
}
