/**
 * Rendu des écrans (lot 5) : aplats, tramage par diffusion ou Bayer (moteur
 * Reveal), trame classique à points (AM) avec linéature, angle et forme du
 * point. Fonctions pures, sans DOM : appelées par le Web Worker et par le
 * banc de test Node.
 *
 * Trame AM : chaque encre reçoit, pixel par pixel, un TON (0 à 255). Un pixel
 * est vu comme le mélange de deux couleurs pures (deux encres, ou une encre et
 * le fond) : la proportion du mélange donne le ton de chaque encre. Le ton est
 * ensuite comparé à une cellule de seuils tournée à l'angle de l'écran, à la
 * linéature voulue ; les seuils sont rangés par ordre de croissance du point,
 * si bien que la surface encrée d'une cellule vaut exactement le ton.
 */
import { HORS_DESSIN } from "./separer";

type Vec = [number, number, number];

export type FormePoint = "rond" | "elliptique" | "ligne";

export type Rendu =
  | { type: "aplat" }
  | { type: "diffusion"; algo: "floyd-steinberg" | "atkinson" | "stucki" }
  | { type: "bayer"; /** Maillage de l'écran, fils/cm (ex. 43, 77, 120). */ maillage: number }
  | {
      type: "am";
      /** Linéature, lignes par pouce. */
      lpi: number;
      /** Angle de chaque écran de couleur, en degrés (ordre des couleurs) ; la sous-couche prend le premier. */
      angles: number[];
      forme: FormePoint;
      /** Ton en dessous duquel rien n'est imprimé (point trop petit pour tenir), %. */
      pointMinPct: number;
      /** Ton au-delà duquel l'aplat est plein (points qui se bouchent), %. */
      pointMaxPct: number;
    };

export const LIBELLES_RENDU: Record<Rendu["type"], string> = {
  aplat: "Aplats (couleurs pleines)",
  diffusion: "Tramage par diffusion (FM)",
  bayer: "Trame Bayer adaptée au maillage",
  am: "Trame classique à points (AM)",
};

/** Linéature maximale conseillée pour un maillage (fils/cm) : ~ fils par pouce ÷ 4. */
export const lpiMaxPourMaillage = (maillage: number) => Math.floor((maillage * 2.54) / 4);

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const rvbDeHex = (hex: string): Vec => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/* ------------------------------------------------------------------------ */
/* Mélanges                                                                 */
/* ------------------------------------------------------------------------ */

/** Côté de la table de correspondance (RVB quantifié sur 6 bits par canal). */
const Q = 64;

/**
 * Explique une couleur par une couleur pure, ou par le mélange de deux
 * couleurs pures (a vers b, t = part de b entre 0 et 1) quand le mélange
 * l'explique nettement mieux.
 */
export function expliquer(c: Vec, purs: Vec[]): { a: number; b: number; t: number } {
  let a = 0;
  let bestD = Infinity;
  for (let k = 0; k < purs.length; k++) {
    const d = distance(c, purs[k]);
    if (d < bestD) {
      bestD = d;
      a = k;
    }
  }
  let res = { a, b: -1, t: 0 };
  for (let i = 0; i < purs.length; i++) {
    for (let j = i + 1; j < purs.length; j++) {
      const A = purs[i];
      const B = purs[j];
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - A[0]) * ab[0] + (c[1] - A[1]) * ab[1] + (c[2] - A[2]) * ab[2]) / l2));
      const d = distance(c, [A[0] + t * ab[0], A[1] + t * ab[1], A[2] + t * ab[2]]);
      if (d + 4 < bestD) {
        bestD = d;
        res = { a: i, b: j, t };
      }
    }
  }
  return res;
}

/**
 * Table de mélanges sur le RVB quantifié : pour chaque teinte, couleur pure a
 * (4 bits), b (4 bits, 15 = aucune) et part de b (8 bits). 16 couleurs pures
 * au plus (encres + fond).
 */
export function tableMelanges(purs: Vec[]) {
  const table = new Uint32Array(Q * Q * Q).fill(0xffffffff);
  return (r: number, g: number, b: number) => {
    const cle = ((r >> 2) * Q + (g >> 2)) * Q + (b >> 2);
    let v = table[cle];
    if (v === 0xffffffff) {
      const e = expliquer([(r & 0xfc) + 2, (g & 0xfc) + 2, (b & 0xfc) + 2], purs);
      v = (e.a << 12) | ((e.b < 0 ? 15 : e.b) << 8) | Math.round(e.t * 255);
      table[cle] = v;
    }
    return v;
  };
}

/** Couleur pure retenue (tranchée à 50 %) d'une valeur de tableMelanges. */
export const pur = (v: number) => {
  const b = (v >> 8) & 15;
  return b === 15 || (v & 255) < 128 ? v >> 12 : b;
};

/** Ton (0 à 255) de la couleur pure k dans une valeur de tableMelanges. */
export const ton = (v: number, k: number) => {
  const a = v >> 12;
  const b = (v >> 8) & 15;
  const t = v & 255;
  if (b === 15) return a === k ? 255 : 0;
  return a === k ? 255 - t : b === k ? t : 0;
};

/* ------------------------------------------------------------------------ */
/* Trame AM                                                                 */
/* ------------------------------------------------------------------------ */

const CELLULE = 64;
const seuilsCache = new Map<FormePoint, Uint8Array>();

/**
 * Cellule de seuils (64 × 64) : les positions sont rangées dans l'ordre où le
 * point grossit (centre d'abord pour un point rond), puis numérotées de 1 à
 * 255 à intervalles égaux : un ton de x % encre exactement x % de la cellule.
 */
export function seuilsAM(forme: FormePoint): Uint8Array {
  const deja = seuilsCache.get(forme);
  if (deja) return deja;
  const n = CELLULE * CELLULE;
  const ordre = Array.from({ length: n }, (_, i) => {
    const u = ((i % CELLULE) + 0.5) / CELLULE - 0.5;
    const v = (Math.floor(i / CELLULE) + 0.5) / CELLULE - 0.5;
    const f = forme === "ligne" ? Math.abs(v) : forme === "elliptique" ? u * u + (v * v) / 0.45 : u * u + v * v;
    // Départage stable des égalités : la cellule reste symétrique et régulière.
    return { i, f: f + i * 1e-9 };
  });
  ordre.sort((x, y) => x.f - y.f);
  const seuils = new Uint8Array(n);
  ordre.forEach((o, rang) => (seuils[o.i] = 1 + Math.floor((rang * 255) / n)));
  seuilsCache.set(forme, seuils);
  return seuils;
}

export type ReglageAM = { ppp: number; lpi: number; angle: number; forme: FormePoint; pointMinPct: number; pointMaxPct: number };

/**
 * Trame AM d'un écran : 1 là où l'encre est déposée. `tonDe(p)` donne le ton
 * (0 à 255) du pixel p ; `p` parcourt l'image ligne par ligne.
 */
export function tramerAM(tonDe: (p: number) => number, w: number, h: number, r: ReglageAM): Uint8Array {
  const seuils = seuilsAM(r.forme);
  const cellules = r.lpi / r.ppp; // cellules par pixel
  const rad = (r.angle * Math.PI) / 180;
  const cos = Math.cos(rad) * cellules;
  const sin = Math.sin(rad) * cellules;
  const min = Math.round((r.pointMinPct / 100) * 255);
  const max = Math.round((r.pointMaxPct / 100) * 255);
  const out = new Uint8Array(w * h);
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      let t = tonDe(p);
      if (t <= 0) continue;
      if (t < min) continue;
      if (t >= max) {
        out[p] = 1;
        continue;
      }
      const u = x * cos + y * sin;
      const v = y * cos - x * sin;
      const fu = u - Math.floor(u);
      const fv = v - Math.floor(v);
      t = t > 255 ? 255 : t;
      if (t >= seuils[((fv * CELLULE) | 0) * CELLULE + ((fu * CELLULE) | 0)]) out[p] = 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Recouvrement (trapping) et empaquetage                                   */
/* ------------------------------------------------------------------------ */

/**
 * Recouvrement : chaque encre déborde de `px` pixels sous les encres plus
 * foncées qu'elle touche (jamais sur le fond), pour absorber les défauts de
 * calage ; la plus foncée garde ses bords nets. Renvoie un masque par encre.
 */
export function recouvrir(indices: Uint8Array, w: number, h: number, luminances: number[], px: number): Uint8Array[] {
  const n = luminances.length;
  const masques = luminances.map((_, k) => {
    const m = new Uint8Array(w * h);
    for (let p = 0; p < m.length; p++) if (indices[p] === k) m[p] = 1;
    return m;
  });
  if (px <= 0 || n < 2) return masques;
  const seuil = Math.min(250, Math.round(px) * 3);
  for (let k = 0; k < n; k++) {
    const plusFoncees = luminances.map((l, j) => j !== k && l < luminances[k]);
    if (!plusFoncees.some(Boolean)) continue;
    // Distance (chanfrein 3-4, plafonnée) à l'encre k.
    const d = new Uint8Array(w * h).fill(255);
    for (let p = 0; p < d.length; p++) if (indices[p] === k) d[p] = 0;
    const m = (a: number, b: number) => (b < a ? b : a);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!d[p]) continue;
        let v = d[p];
        if (x > 0) v = m(v, d[p - 1] + 3);
        if (y > 0) v = m(v, d[p - w] + 3);
        if (x > 0 && y > 0) v = m(v, d[p - w - 1] + 4);
        if (x < w - 1 && y > 0) v = m(v, d[p - w + 1] + 4);
        d[p] = v > 255 ? 255 : v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const p = y * w + x;
        if (!d[p]) continue;
        let v = d[p];
        if (x < w - 1) v = m(v, d[p + 1] + 3);
        if (y < h - 1) v = m(v, d[p + w] + 3);
        if (x < w - 1 && y < h - 1) v = m(v, d[p + w + 1] + 4);
        if (x > 0 && y < h - 1) v = m(v, d[p + w - 1] + 4);
        d[p] = v > 255 ? 255 : v;
      }
    }
    const mk = masques[k];
    for (let p = 0; p < d.length; p++) {
      const j = indices[p];
      if (d[p] > 0 && d[p] <= seuil && j !== HORS_DESSIN && plusFoncees[j]) mk[p] = 1;
    }
  }
  return masques;
}

/**
 * Masque 1 bit pour le PDF (/ImageMask, 8 pixels par octet, lignes complétées
 * à l'octet) : bit 0 = encre déposée.
 */
export function empaqueter(masque: Uint8Array, w: number, h: number, miroir: boolean): Uint8Array {
  const parLigne = Math.ceil(w / 8);
  const out = new Uint8Array(parLigne * h).fill(0xff);
  for (let y = 0; y < h; y++) {
    const ligne = y * w;
    for (let x = 0; x < w; x++) {
      if (!masque[ligne + x]) continue;
      const xs = miroir ? w - 1 - x : x;
      out[y * parLigne + (xs >> 3)] &= ~(0x80 >> (xs & 7));
    }
  }
  return out;
}
