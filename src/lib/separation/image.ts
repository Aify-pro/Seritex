/**
 * Réglages manuels de l'image (lot 7), appliqués AVANT la séparation et aux
 * films : luminosité, contraste, saturation, gamma, niveaux (points noir et
 * blanc), rotation de teinte, netteté (masque flou), réduction du bruit
 * (médian), inversion. La transparence n'est pas touchée. Fonctions pures.
 */

export type ReglagesImage = {
  /** -100 à 100. */
  luminosite: number;
  /** -100 à 100. */
  contraste: number;
  /** -100 (gris) à 100. */
  saturation: number;
  /** 0,2 à 3 (1 = neutre ; > 1 éclaircit les tons moyens). */
  gamma: number;
  /** Niveaux d'entrée : en dessous du noir → noir, au-dessus du blanc → blanc (0 à 255). */
  noir: number;
  blanc: number;
  /** Rotation de teinte, degrés. */
  teinte: number;
  /** Netteté (masque flou), 0 à 200 %. */
  nettete: number;
  /** Réduction du bruit : rayon du filtre médian (0 = aucun). */
  bruit: 0 | 1 | 2;
  inverser: boolean;
};

export const IMAGE_NEUTRE: ReglagesImage = {
  luminosite: 0,
  contraste: 0,
  saturation: 0,
  gamma: 1,
  noir: 0,
  blanc: 255,
  teinte: 0,
  nettete: 0,
  bruit: 0,
  inverser: false,
};

export const imageNeutre = (r: ReglagesImage) =>
  (Object.keys(IMAGE_NEUTRE) as (keyof ReglagesImage)[]).every((k) => r[k] === IMAGE_NEUTRE[k]);

/** Table de correspondance des tons (luminosité, contraste, niveaux, gamma, inversion). */
function tableTons(r: ReglagesImage): Uint8Array {
  const t = new Uint8Array(256);
  const plage = Math.max(1, r.blanc - r.noir);
  const k = r.contraste >= 0 ? 1 + r.contraste / 50 : 1 + r.contraste / 100;
  for (let v = 0; v < 256; v++) {
    let x = Math.min(1, Math.max(0, (v - r.noir) / plage));
    x = Math.pow(x, 1 / r.gamma);
    x = (x - 0.5) * k + 0.5 + r.luminosite / 200;
    if (r.inverser) x = 1 - x;
    t[v] = Math.round(Math.min(1, Math.max(0, x)) * 255);
  }
  return t;
}

function medianRgb(src: Uint8ClampedArray, w: number, h: number, rayon: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const vals: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      vals[0].length = vals[1].length = vals[2].length = 0;
      for (let dy = -rayon; dy <= rayon; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -rayon; dx <= rayon; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const o = (yy * w + xx) * 4;
          vals[0].push(src[o]);
          vals[1].push(src[o + 1]);
          vals[2].push(src[o + 2]);
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        vals[c].sort((a, b) => a - b);
        out[o + c] = vals[c][vals[c].length >> 1];
      }
    }
  }
  return out;
}

/** Flou boîte séparable (rayon r) d'un canal RVBA. */
function flou(src: Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dx = -r; dx <= r; dx++) s += src[(y * w + Math.min(w - 1, Math.max(0, dx))) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = s / n;
        s += src[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] - src[(y * w + Math.max(0, x - r)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) s += tmp[(Math.min(h - 1, Math.max(0, dy)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = s / n;
        s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c];
      }
    }
  }
  return out;
}

/**
 * Applique les réglages à une image RVBA (nouvelle image). `echelle` = pixels
 * de cette image par pixel de l'image d'analyse : la netteté et le bruit
 * gardent le même effet visuel sur les films en pleine résolution.
 */
export function ajusterImage(px: Uint8ClampedArray | Uint8Array, w: number, h: number, r: ReglagesImage, echelle = 1): Uint8ClampedArray {
  let out: Uint8ClampedArray = new Uint8ClampedArray(px);
  if (imageNeutre(r)) return out;
  const n = w * h;

  if (r.bruit > 0) out = medianRgb(out, w, h, Math.max(1, Math.round(r.bruit * Math.min(echelle, 3))));

  if (r.nettete > 0) {
    const f = flou(out, w, h, Math.max(1, Math.round(echelle)));
    const a = r.nettete / 100;
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const o = p * 4 + c;
        out[o] = out[o] + a * (out[o] - f[p * 3 + c]);
      }
    }
  }

  const tons = tableTons(r);
  const sat = 1 + r.saturation / 100;
  const rad = (r.teinte * Math.PI) / 180;
  const cosT = Math.cos(rad);
  const sinT = Math.sin(rad);
  // Rotation de teinte dans l'espace YIQ (luminance conservée).
  const rotation = r.teinte !== 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    let R = tons[out[o]];
    let G = tons[out[o + 1]];
    let B = tons[out[o + 2]];
    if (rotation || sat !== 1) {
      const Y = 0.299 * R + 0.587 * G + 0.114 * B;
      let I = 0.596 * R - 0.274 * G - 0.322 * B;
      let Q = 0.211 * R - 0.523 * G + 0.312 * B;
      if (rotation) [I, Q] = [I * cosT - Q * sinT, I * sinT + Q * cosT];
      I *= sat;
      Q *= sat;
      R = Y + 0.956 * I + 0.621 * Q;
      G = Y - 0.272 * I - 0.647 * Q;
      B = Y - 1.106 * I + 1.703 * Q;
    }
    out[o] = R;
    out[o + 1] = G;
    out[o + 2] = B;
  }
  return out;
}
