/**
 * Séparation des couleurs côté navigateur : charge l'image dans un canvas,
 * confie le calcul au Web Worker (repli sur le fil principal si le
 * navigateur refuse le worker) et dessine les écrans.
 */
import { HORS_DESSIN, type OptionsSeparation, type ResultatSeparation } from "./separer";

export type { CouleurSeparee, ResultatSeparation } from "./separer";
export { HORS_DESSIN } from "./separer";

/** Côté maximal de l'image analysée : assez pour les traits fins, rapide à calculer. */
export const COTE_SEPARATION = 700;

let worker: Worker | null = null;
let workerHS = false;
let suivant = 1;
const enAttente = new Map<number, { ok: (r: ResultatSeparation) => void; ko: (e: Error) => void }>();

function obtenirWorker(): Worker | null {
  if (workerHS || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; resultat?: ResultatSeparation; erreur?: string }>) => {
      const attente = enAttente.get(e.data.id);
      if (!attente) return;
      enAttente.delete(e.data.id);
      if (e.data.resultat) attente.ok(e.data.resultat);
      else attente.ko(new Error(e.data.erreur ?? "séparation impossible"));
    };
    worker.onerror = () => {
      workerHS = true;
      worker = null;
      for (const a of enAttente.values()) a.ko(new Error("worker indisponible"));
      enAttente.clear();
    };
    return worker;
  } catch {
    workerHS = true;
    return null;
  }
}

async function surFilPrincipal(px: Uint8ClampedArray, w: number, h: number, options: OptionsSeparation) {
  const [{ default: reveal }, { separer }] = await Promise.all([import("./reveal-core.js"), import("./separer")]);
  return separer(reveal, px, w, h, options);
}

/** Sépare les couleurs de pixels RVBA déjà extraits d'un canvas. */
export async function separerPixels(px: Uint8ClampedArray, w: number, h: number, options: OptionsSeparation = {}) {
  const w0 = obtenirWorker();
  if (!w0) return surFilPrincipal(px, w, h, options);
  try {
    return await new Promise<ResultatSeparation>((ok, ko) => {
      const id = suivant++;
      enAttente.set(id, { ok, ko });
      w0.postMessage({ id, px, w, h, options });
    });
  } catch {
    return surFilPrincipal(px, w, h, options);
  }
}

/** Charge une image (fichier ou URL accessible en CORS) réduite à COTE_SEPARATION. */
export async function lireImage(source: Blob | string, cote = COTE_SEPARATION) {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error("image illisible"));
      i.src = url;
    });
    const l0 = img.naturalWidth || cote;
    const h0 = img.naturalHeight || cote;
    const echelle = Math.min(1, cote / Math.max(l0, h0));
    // Un SVG sans taille propre est rendu à la taille d'analyse.
    const w = Math.max(1, Math.round(img.naturalWidth ? l0 * echelle : cote));
    const h = Math.max(1, Math.round(img.naturalHeight ? h0 * echelle : cote));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return { px: ctx.getImageData(0, 0, w, h).data, w, h, largeurOrigine: l0, hauteurOrigine: h0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const rvb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Dessine le résultat en PNG (data URL).
 *  - `index` absent : le visuel recomposé avec ses seules encres, fond transparent ;
 *  - `index` donné : l'écran de cette couleur, en noir sur blanc comme un film.
 */
export function dessiner(r: ResultatSeparation, index?: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = r.largeur;
  canvas.height = r.hauteur;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(r.largeur, r.hauteur);
  const couleurs = r.couleurs.map((c) => rvb(c.hex));
  for (let p = 0; p < r.indices.length; p++) {
    const k = r.indices[p];
    const o = p * 4;
    if (index === undefined) {
      if (k === HORS_DESSIN) continue;
      [img.data[o], img.data[o + 1], img.data[o + 2]] = couleurs[k];
      img.data[o + 3] = 255;
    } else {
      const v = k === index ? 0 : 255;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
