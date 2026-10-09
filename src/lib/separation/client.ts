/**
 * Séparation des couleurs côté navigateur : charge l'image dans un canvas,
 * confie le calcul au Web Worker (repli sur le fil principal si le
 * navigateur refuse le worker) et dessine les écrans.
 */
import { HORS_DESSIN, type Films, type OptionsSeparation, type ResultatSeparation } from "./separer";
import type { EcransFilms, EntreeFilms } from "./ecrans";
import type { ReglagesImage } from "./image";
import type { Rendu } from "./trame";

export type { CouleurSeparee, Films, ResultatSeparation } from "./separer";
export { HORS_DESSIN } from "./separer";

/** Côté maximal de l'image analysée : assez pour les traits fins, rapide à calculer. */
export const COTE_SEPARATION = 700;

let worker: Worker | null = null;
let workerHS = false;
let suivant = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const enAttente = new Map<number, { ok: (r: any) => void; ko: (e: Error) => void }>();

function obtenirWorker(): Worker | null {
  if (workerHS || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; resultat?: unknown; erreur?: string }>) => {
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

/** Envoie un calcul au worker ; null si le navigateur n'en a pas. */
function viaWorker<T>(message: Record<string, unknown>, transfert: Transferable[]): Promise<T> | null {
  const w0 = obtenirWorker();
  if (!w0) return null;
  return new Promise<T>((ok, ko) => {
    const id = suivant++;
    enAttente.set(id, { ok, ko });
    w0.postMessage({ ...message, id }, transfert);
  });
}

async function surFilPrincipal(px: Uint8ClampedArray, w: number, h: number, options: OptionsSeparation) {
  const [{ default: reveal }, { separer }] = await Promise.all([import("./reveal-core.js"), import("./separer")]);
  return separer(reveal, px, w, h, options);
}

/** Sépare les couleurs de pixels RVBA déjà extraits d'un canvas. */
export async function separerPixels(px: Uint8ClampedArray, w: number, h: number, options: OptionsSeparation = {}) {
  try {
    const r = viaWorker<ResultatSeparation>({ type: "separer", px, w, h, options }, []);
    if (r) return await r;
  } catch {
    // repli ci-dessous
  }
  return surFilPrincipal(px, w, h, options);
}

/**
 * Applique les encres retenues à une image en pleine résolution et recadre
 * sur le dessin (voir appliquerEncres). Les pixels sont transférés au worker :
 * `px` n'est plus utilisable ensuite.
 */
export async function appliquerEncresPixels(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  r: ResultatSeparation,
  pixelsMin = 4,
  rentrePx: number | null = null,
): Promise<Films> {
  const encres = r.couleurs.map((c) => c.hex);
  try {
    const f = viaWorker<Films>({ type: "films", px, w, h, encres, fond: r.fond, transparent: r.transparent, pixelsMin, rentrePx }, [px.buffer]);
    if (f) return await f;
  } catch {
    // repli ci-dessous
  }
  const { appliquerEncres } = await import("./separer");
  return appliquerEncres(px, w, h, encres, r.fond, r.transparent, pixelsMin, rentrePx);
}

async function chargerImage(source: Blob | string) {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error("image illisible"));
      i.src = url;
    });
  } finally {
    // L'image décodée reste utilisable après la révocation.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function pixels(img: HTMLImageElement, w: number, h: number, zone?: { x: number; y: number; l: number; h: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  if (zone) {
    // Un SVG sans taille propre est rendu à la taille demandée.
    const l0 = img.naturalWidth || w / zone.l;
    const h0 = img.naturalHeight || h / zone.h;
    ctx.drawImage(img, zone.x * l0, zone.y * h0, zone.l * l0, zone.h * h0, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return ctx.getImageData(0, 0, w, h).data;
}

/** Aperçu d'un rendu (image d'analyse) : couleur pure par pixel, ou tons par encre en trame AM. */
export async function renduApercu(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  r: ResultatSeparation,
  rendu: Rendu,
  ppp: number,
): Promise<{ indices?: Uint8Array; tons?: Uint8Array[] }> {
  const message = { type: "rendu", px, w, h, encres: r.couleurs.map((c) => c.hex), fond: r.fond, transparent: r.transparent, rendu, ppp };
  try {
    const res = viaWorker<{ indices?: Uint8Array; tons?: Uint8Array[] }>(message, [px.buffer]);
    if (res) return await res;
  } catch {
    // repli ci-dessous
  }
  const { indicesRendu, tonsRendu } = await import("./ecrans");
  return rendu.type === "am" || rendu.type === "cmjn" ? { tons: tonsRendu(px, w, h, message) } : { indices: indicesRendu(px, w, h, message) };
}

/** Films en pleine résolution selon le rendu (voir ecransFilms). `px` est transféré au worker. */
export async function ecransFilmsPixels(px: Uint8ClampedArray, w: number, h: number, entree: EntreeFilms): Promise<EcransFilms> {
  try {
    const f = viaWorker<EcransFilms>({ type: "ecrans", px, w, h, entree }, [px.buffer]);
    if (f) return await f;
  } catch {
    // repli ci-dessous
  }
  const { ecransFilms } = await import("./ecrans");
  return ecransFilms(px, w, h, entree);
}

/** Charge une image (fichier ou URL accessible en CORS) réduite à `cote` pixels sur son plus grand côté. */
export async function lireImage(source: Blob | string, cote = COTE_SEPARATION) {
  const img = await chargerImage(source);
  const l0 = img.naturalWidth || cote;
  const h0 = img.naturalHeight || cote;
  const echelle = Math.min(1, cote / Math.max(l0, h0));
  // Un SVG sans taille propre est rendu à la taille d'analyse.
  const w = Math.max(1, Math.round(img.naturalWidth ? l0 * echelle : cote));
  const h = Math.max(1, Math.round(img.naturalHeight ? h0 * echelle : cote));
  return { px: pixels(img, w, h), w, h, largeurOrigine: l0, hauteurOrigine: h0 };
}

/**
 * Relit une zone de l'image (fractions de l'image) à la taille demandée,
 * agrandie si besoin : sert aux films en pleine résolution.
 */
export async function lireZone(source: Blob | string, zone: { x: number; y: number; l: number; h: number }, w: number, h: number) {
  const img = await chargerImage(source);
  return { px: pixels(img, w, h, zone), w, h };
}

const rvb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Dessine le résultat en PNG (data URL).
 *  - `index` absent : le visuel recomposé avec ses seules encres, fond transparent ;
 *  - `index` donné : l'écran de cette couleur, en noir sur blanc comme un film ;
 *  - `index` = "dessin" : tout le dessin en noir (aperçu de la sous-couche).
 * `indices` remplace ceux du résultat (rendu tramé) ; `tons` (trame AM) donne
 * des écrans en niveaux de gris et une recomposition par mélange des encres.
 */
export function dessiner(r: ResultatSeparation, index?: number | "dessin", rendu?: { indices?: Uint8Array; tons?: Uint8Array[] }): string {
  const canvas = document.createElement("canvas");
  canvas.width = r.largeur;
  canvas.height = r.hauteur;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(r.largeur, r.hauteur);
  const couleurs = r.couleurs.map((c) => rvb(c.hex));
  const indices = rendu?.indices ?? r.indices;
  const tons = rendu?.tons;
  for (let p = 0; p < indices.length; p++) {
    const o = p * 4;
    if (tons) {
      if (index === undefined) {
        // Encres déposées l'une sur l'autre (mélange soustractif), chacune selon son ton.
        let c = [255, 255, 255];
        let encre = 0;
        tons.forEach((t, k) => {
          const a = t[p] / 255;
          if (!a) return;
          encre = Math.max(encre, t[p]);
          c = c.map((v, j) => v * (1 - a + (a * couleurs[k][j]) / 255));
        });
        if (!encre) continue;
        [img.data[o], img.data[o + 1], img.data[o + 2]] = c;
        img.data[o + 3] = 255;
      } else {
        const t = index === "dessin" ? tons.reduce((m, x) => Math.max(m, x[p]), 0) : tons[index][p];
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255 - t;
        img.data[o + 3] = 255;
      }
      continue;
    }
    const k = indices[p];
    if (index === undefined) {
      if (k === HORS_DESSIN) continue;
      [img.data[o], img.data[o + 1], img.data[o + 2]] = couleurs[k];
      img.data[o + 3] = 255;
    } else {
      const v = (index === "dessin" ? k !== HORS_DESSIN : k === index) ? 0 : 255;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Loupe : un carré de `coteCm` du film, au centre du dessin, à sa vraie
 * résolution et selon le rendu choisi — pour juger la trame (taille et angle
 * des points) avant de télécharger les films. Image recomposée (data URL).
 */
export async function loupeRendu(
  source: Blob | string,
  r: ResultatSeparation,
  rendu: Rendu,
  ppp: number,
  largeurCm: number,
  image?: ReglagesImage,
  coteCm = 2.5,
): Promise<{ url: string; cote: number }> {
  const [{ dimensionsFilms }, { indicesRendu, tonsRendu }, { tramerAM, ENCRES_CMJN }, { ajusterImage }] = await Promise.all([
    import("./dimensions-films"),
    import("./ecrans"),
    import("./trame"),
    import("./image"),
  ]);
  const { zone } = dimensionsFilms(r, largeurCm, ppp);
  // Fraction de l'image couverte par le carré : la largeur du dessin vaut largeurCm.
  const fl = Math.min(zone.l, ((coteCm / largeurCm) * zone.l) / 1.04);
  const fh = Math.min(zone.h, (fl * r.largeur) / r.hauteur);
  const cx = zone.x + zone.l / 2;
  const cy = zone.y + zone.h / 2;
  const sous = { x: Math.max(0, cx - fl / 2), y: Math.max(0, cy - fh / 2), l: fl, h: fh };
  const cote = Math.max(16, Math.round((coteCm / 2.54) * ppp));
  const hauteur = Math.max(16, Math.round((cote * fh * r.hauteur) / (fl * r.largeur)));
  const lu = await lireZone(source, sous, cote, hauteur);
  const { w, h } = lu;
  const px = image ? ajusterImage(lu.px, w, h, image, w / Math.max(1, fl * r.largeur)) : lu.px;
  const hexEncres: string[] = rendu.type === "cmjn" ? ENCRES_CMJN.map((e) => e.hex) : r.couleurs.map((c) => c.hex);
  const entree = { encres: hexEncres, fond: r.fond, transparent: r.transparent, rendu, ppp };
  const couleurs = hexEncres.map((hex) => rvb(hex));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  img.data.fill(255);
  if (rendu.type === "am" || rendu.type === "cmjn") {
    const tons = tonsRendu(px, w, h, entree);
    tons.forEach((t, k) => {
      const m = tramerAM((p) => t[p], w, h, {
        ppp,
        lpi: rendu.lpi,
        angle: rendu.angles[k] ?? rendu.angles[0] ?? 22.5,
        forme: rendu.forme,
        pointMinPct: rendu.pointMinPct,
        pointMaxPct: rendu.pointMaxPct,
      });
      for (let p = 0; p < m.length; p++) {
        if (!m[p]) continue;
        const o = p * 4;
        if (rendu.type === "cmjn") {
          // Encres transparentes de quadrichromie : elles se multiplient.
          for (let j = 0; j < 3; j++) img.data[o + j] = (img.data[o + j] * couleurs[k][j]) / 255;
        } else {
          // Encres couvrantes : la dernière imprimée recouvre.
          [img.data[o], img.data[o + 1], img.data[o + 2]] = couleurs[k];
        }
      }
    });
  } else {
    const indices = indicesRendu(px, w, h, entree);
    for (let p = 0; p < indices.length; p++) if (indices[p] !== HORS_DESSIN) [img.data[p * 4], img.data[p * 4 + 1], img.data[p * 4 + 2]] = couleurs[indices[p]];
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL("image/png"), cote: w };
}
