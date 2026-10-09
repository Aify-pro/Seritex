/**
 * Écrans d'une séparation selon le rendu choisi (lot 5) : aplats, tramage
 * par diffusion (Floyd-Steinberg, Atkinson, Stucki), Bayer adapté au
 * maillage, trame AM. Sert à l'aperçu (image d'analyse) et aux films (pleine
 * résolution, dans le Web Worker). Fonctions pures, sans DOM.
 */
import { HORS_DESSIN, sansIlots, sousCouche } from "./separer";
import { empaqueter, recouvrir, rvbDeHex, tableMelanges, ton, pur, tramerAM, versCmjn, type Rendu } from "./trame";
import { ajusterImage, imageNeutre, type ReglagesImage } from "./image";

type Vec = [number, number, number];

/** Pixel transparent (hors dessin) dans le tableau des mélanges. */
const TRANSPARENT = 0xffff;

type Entree = {
  encres: string[];
  fond: string | null;
  transparent: boolean;
  rendu: Rendu;
  /** Résolution de l'image (points par pouce) : linéature AM, cellules Bayer. */
  ppp: number;
};

/** Couleurs pures (encres, puis le fond s'il y en a un) et mélanges de chaque pixel. */
function melanges(px: Uint8ClampedArray | Uint8Array, n: number, e: Entree) {
  const purs: Vec[] = e.encres.map(rvbDeHex);
  const avecFond = !!e.fond || e.transparent;
  if (avecFond) purs.push(e.fond ? rvbDeHex(e.fond) : [255, 255, 255]);
  const indexFond = avecFond ? purs.length - 1 : -1;
  const table = tableMelanges(purs);
  const vals = new Uint16Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    vals[p] = e.transparent && px[i + 3] < 128 ? TRANSPARENT : table(px[i], px[i + 1], px[i + 2]);
  }
  return { purs, indexFond, vals };
}

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

const NOYAUX: Record<"floyd-steinberg" | "atkinson" | "stucki", { dx: number; dy: number; f: number }[]> = {
  "floyd-steinberg": [
    { dx: 1, dy: 0, f: 7 / 16 },
    { dx: -1, dy: 1, f: 3 / 16 },
    { dx: 0, dy: 1, f: 5 / 16 },
    { dx: 1, dy: 1, f: 1 / 16 },
  ],
  // Atkinson ne diffuse que 3/4 de l'erreur : contrastes francs.
  atkinson: [
    { dx: 1, dy: 0, f: 1 / 8 },
    { dx: 2, dy: 0, f: 1 / 8 },
    { dx: -1, dy: 1, f: 1 / 8 },
    { dx: 0, dy: 1, f: 1 / 8 },
    { dx: 1, dy: 1, f: 1 / 8 },
    { dx: 0, dy: 2, f: 1 / 8 },
  ],
  stucki: [
    { dx: 1, dy: 0, f: 8 / 42 },
    { dx: 2, dy: 0, f: 4 / 42 },
    { dx: -2, dy: 1, f: 2 / 42 },
    { dx: -1, dy: 1, f: 4 / 42 },
    { dx: 0, dy: 1, f: 8 / 42 },
    { dx: 1, dy: 1, f: 4 / 42 },
    { dx: 2, dy: 1, f: 2 / 42 },
    { dx: -2, dy: 2, f: 1 / 42 },
    { dx: -1, dy: 2, f: 2 / 42 },
    { dx: 0, dy: 2, f: 4 / 42 },
    { dx: 1, dy: 2, f: 2 / 42 },
    { dx: 2, dy: 2, f: 1 / 42 },
  ],
};

/**
 * Couleur pure de chaque pixel (index d'encre, ou HORS_DESSIN pour le fond)
 * selon le rendu : tranchée à 50 % (aplats), diffusée (FM) ou ordonnée
 * (Bayer, cellules agrandies pour tenir sur le maillage : « règle de 7 »).
 */
export function indicesRendu(px: Uint8ClampedArray | Uint8Array, w: number, h: number, e: Entree): Uint8Array {
  const n = w * h;
  const { purs, indexFond, vals } = melanges(px, n, e);
  const out = new Uint8Array(n);
  const versIndice = (k: number) => (k === indexFond ? HORS_DESSIN : k);

  if (e.rendu.type === "diffusion") {
    // Diffusion d'erreur en RVB vers la couleur pure la plus proche (balayage en serpentin).
    const noyau = NOYAUX[e.rendu.algo];
    const lignes = 3;
    const err = Array.from({ length: lignes }, () => new Float32Array(w * 3));
    for (let y = 0; y < h; y++) {
      const gauche = y % 2 === 1;
      for (let i = 0; i < w; i++) {
        const x = gauche ? w - 1 - i : i;
        const p = y * w + x;
        if (vals[p] === TRANSPARENT) {
          out[p] = HORS_DESSIN;
          continue;
        }
        const o = p * 4;
        const e0 = err[0];
        const c: Vec = [px[o] + e0[x * 3], px[o + 1] + e0[x * 3 + 1], px[o + 2] + e0[x * 3 + 2]];
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < purs.length; k++) {
          const d = (c[0] - purs[k][0]) ** 2 + (c[1] - purs[k][1]) ** 2 + (c[2] - purs[k][2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        out[p] = versIndice(best);
        const er = [c[0] - purs[best][0], c[1] - purs[best][1], c[2] - purs[best][2]];
        for (const { dx, dy, f } of noyau) {
          const xx = x + (gauche ? -dx : dx);
          if (xx < 0 || xx >= w || y + dy >= h) continue;
          const l = err[dy];
          l[xx * 3] += er[0] * f;
          l[xx * 3 + 1] += er[1] * f;
          l[xx * 3 + 2] += er[2] * f;
        }
      }
      err.push(err.shift()!.fill(0));
    }
    return out;
  }

  // Bayer : la part du mélange est comparée à la matrice 8 × 8, en cellules
  // assez grosses pour tenir sur le maillage (linéature max = fils/pouce ÷ 7).
  const echelle =
    e.rendu.type === "bayer" ? Math.max(1, Math.round(e.ppp / Math.max(1, (e.rendu.maillage * 2.54) / 7))) : 1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const v = vals[p];
      if (v === TRANSPARENT) {
        out[p] = HORS_DESSIN;
        continue;
      }
      if (e.rendu.type !== "bayer") {
        out[p] = versIndice(pur(v));
        continue;
      }
      const b = (v >> 8) & 15;
      if (b === 15) {
        out[p] = versIndice(v >> 12);
        continue;
      }
      const seuil = (BAYER8[(((y / echelle) | 0) & 7) * 8 + (((x / echelle) | 0) & 7)] + 0.5) / 64;
      out[p] = versIndice((v & 255) / 255 > seuil ? b : v >> 12);
    }
  }
  return out;
}

/**
 * Tons C, M, J, N de chaque pixel (quadrichromie) ; le fond (uni ou
 * transparent) n'est pas imprimé. Mis en cache par teinte.
 */
export function tonsCmjn(px: Uint8ClampedArray | Uint8Array, w: number, h: number, e: Entree): Uint8Array[] {
  if (e.rendu.type !== "cmjn") throw new Error("rendu CMJN attendu");
  const reglage = e.rendu;
  const n = w * h;
  const out = [0, 1, 2, 3].map(() => new Uint8Array(n));
  const fond = e.fond ? rvbDeHex(e.fond) : null;
  const cache = new Map<number, number>();
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (e.transparent && px[i + 3] < 128) continue;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (fond && Math.abs(r - fond[0]) + Math.abs(g - fond[1]) + Math.abs(b - fond[2]) < 24) continue;
    const cle = (r << 16) | (g << 8) | b;
    let v = cache.get(cle);
    if (v === undefined) {
      const t = versCmjn(r, g, b, reglage);
      v = (t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3];
      cache.set(cle, v);
    }
    out[0][p] = (v >>> 24) & 255;
    out[1][p] = (v >>> 16) & 255;
    out[2][p] = (v >>> 8) & 255;
    out[3][p] = v & 255;
  }
  return out;
}

/** Ton (0 à 255) de chaque encre en chaque pixel : base de la trame AM et de son aperçu. */
export function tonsRendu(px: Uint8ClampedArray | Uint8Array, w: number, h: number, e: Entree): Uint8Array[] {
  if (e.rendu.type === "cmjn") return tonsCmjn(px, w, h, e);
  const n = w * h;
  const { vals } = melanges(px, n, e);
  return e.encres.map((_, k) => {
    const t = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (vals[p] !== TRANSPARENT) t[p] = ton(vals[p], k);
    return t;
  });
}

export type EntreeFilms = Entree & {
  /** Îlots plus petits retirés (aplats seulement), en pixels. */
  pixelsMin: number;
  /** Recouvrement des encres claires sous les foncées, en pixels (aplats seulement). */
  recouvrementPx: number;
  /** Sous-couche blanche : rentré en pixels ; null = pas de sous-couche. */
  sousCouche: { rentrePx: number } | null;
  miroir: boolean;
  /** Réglages manuels de l'image, appliqués avant tout (lot 7). */
  image?: ReglagesImage;
  /** Pixels de cette image par pixel de l'image d'analyse (netteté, bruit). */
  echelleImage?: number;
};

export type EcransFilms = {
  largeur: number;
  hauteur: number;
  /** Masques 1 bit (/ImageMask) dans l'ordre d'impression : sous-couche puis couleurs. */
  ecrans: Uint8Array[];
};

/**
 * Films en pleine résolution : rendu, recadrage sur le dessin, nettoyage,
 * recouvrement, sous-couche, trame AM, puis masques 1 bit prêts pour le PDF.
 */
export function ecransFilms(pxSource: Uint8ClampedArray | Uint8Array, w: number, h: number, e: EntreeFilms): EcransFilms {
  const px = e.image && !imageNeutre(e.image) ? ajusterImage(pxSource, w, h, e.image, e.echelleImage ?? 1) : pxSource;
  const cmjn = e.rendu.type === "cmjn" ? e.rendu : null;
  const am = e.rendu.type === "am" ? e.rendu : cmjn ? { ...cmjn, type: "am" as const, angles: [...cmjn.angles] } : null;
  // Cadrage sur le dessin (en AM, un ton faible compte aussi).
  const tons = am ? tonsRendu(px, w, h, e) : null;
  // Aplats tranchés à 50 % : base des films d'aplats, du cadrage et de la sous-couche.
  // En quadrichromie, le dessin est ce qui reçoit de l'encre (ton ≥ 10 %).
  const plats = cmjn && tons
    ? (() => {
        const v = new Uint8Array(w * h).fill(HORS_DESSIN);
        for (let p = 0; p < v.length; p++) if (tons.some((t) => t[p] >= 26)) v[p] = 0;
        return v;
      })()
    : indicesRendu(px, w, h, am ? { ...e, rendu: { type: "aplat" } } : e);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const dedans = plats[p] !== HORS_DESSIN || (tons ? tons.some((t) => t[p] > 0) : false);
      if (!dedans) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("dessin vide");
  const lw = x1 - x0 + 1;
  const lh = y1 - y0 + 1;
  const recadrer = (v: Uint8Array) => {
    const out = new Uint8Array(lw * lh);
    for (let y = 0; y < lh; y++) out.set(v.subarray((y + y0) * w + x0, (y + y0) * w + x0 + lw), y * lw);
    return out;
  };

  let indices: Uint8Array = recadrer(plats);
  if (e.rendu.type === "aplat") indices = sansIlots(indices, lw, lh, e.pixelsMin);
  const ecrans: Uint8Array[] = [];
  const pack = (m: Uint8Array) => empaqueter(m, lw, lh, e.miroir);

  // Sous-couche : réunion des encres (aplats) rentrée ; en AM, tramée sous le ton le plus fort.
  if (e.sousCouche) {
    const plein = sousCouche({ largeur: lw, hauteur: lh, indices }, e.sousCouche.rentrePx);
    if (am && tons) {
      const tonsCadres = tons.map(recadrer);
      const trame = tramerAM(
        (p) => (plein[p] ? tonsCadres.reduce((m, t) => (t[p] > m ? t[p] : m), 0) : 0),
        lw,
        lh,
        { ppp: e.ppp, lpi: am.lpi, angle: am.angles[0] ?? 22.5, forme: am.forme, pointMinPct: am.pointMinPct, pointMaxPct: am.pointMaxPct },
      );
      ecrans.push(pack(trame));
    } else {
      ecrans.push(pack(plein));
    }
  }

  if (am && tons) {
    tons.forEach((t, k) => {
      const tc = recadrer(t);
      ecrans.push(
        pack(
          tramerAM((p) => tc[p], lw, lh, {
            ppp: e.ppp,
            lpi: am.lpi,
            angle: am.angles[k] ?? am.angles[0] ?? 22.5,
            forme: am.forme,
            pointMinPct: am.pointMinPct,
            pointMaxPct: am.pointMaxPct,
          }),
        ),
      );
    });
  } else {
    const luminances = e.encres.map((hex) => {
      const [r, g, b] = rvbDeHex(hex);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    });
    const masques = recouvrir(indices, lw, lh, luminances, e.rendu.type === "aplat" ? e.recouvrementPx : 0);
    for (const m of masques) ecrans.push(pack(m));
  }
  return { largeur: lw, hauteur: lh, ecrans };
}
