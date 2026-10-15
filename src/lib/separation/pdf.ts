/**
 * Lecture des PDF pour la séparation des couleurs. Un PDF de studio est le plus
 * souvent un dessin vectoriel : on le dessine directement à la taille voulue
 * (analyse à 700 px, puis films à 360 ppp et plus) au lieu de le convertir en
 * image puis de l'agrandir. Les contours sont donc nets à toute résolution,
 * sans bloc ni liseré de compression. Première page seulement.
 *
 * pdf.js (Apache 2.0) tourne dans le navigateur, le fichier n'est pas envoyé.
 * Ses polices standard, profils ICC et décodeurs wasm sont servis depuis
 * /pdfjs/ (copiés de node_modules par scripts/copier-pdfjs.mjs avant le build).
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// Version « legacy » : la version courante exige des API très récentes (Uint8Array.toHex…) absentes des navigateurs plus anciens.

/** Zone du visuel en fractions de la page (voir dimensions-films). */
type Zone = { x: number; y: number; l: number; h: number };

export type PagePdf = {
  /** Taille de la page en points (1/72 pouce), rotation comprise. */
  largeurPt: number;
  hauteurPt: number;
  nbPages: number;
  /** Dessine la zone (toute la page par défaut) dans un canvas de w × h pixels, fond transparent. */
  dessiner(w: number, h: number, zone?: Zone): Promise<HTMLCanvasElement>;
};

/** Un fichier est un PDF s'il commence par « %PDF » (le type MIME d'un envoi n'est pas fiable). */
export async function estPdf(blob: Blob): Promise<boolean> {
  if (blob.type === "application/pdf") return true;
  const debut = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const texte = String.fromCharCode(...debut);
  return texte.includes("%PDF-");
}

const BASE = "/pdfjs/";
const ouverts = new WeakMap<Blob, Promise<PagePdf>>();
let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

function chargerPdfjs() {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return pdfjs;
}

/** Ouvre un PDF (la page 1). Le résultat est mémorisé par fichier : analyse et films le relisent sans le reparser. */
export function ouvrirPdf(blob: Blob): Promise<PagePdf> {
  let p = ouverts.get(blob);
  if (!p) {
    p = lire(blob);
    ouverts.set(blob, p);
    p.catch(() => ouverts.delete(blob));
  }
  return p;
}

async function lire(blob: Blob): Promise<PagePdf> {
  const lib = await chargerPdfjs();
  let doc: PDFDocumentProxy;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      standardFontDataUrl: `${BASE}standard_fonts/`,
      wasmUrl: `${BASE}wasm/`,
      iccUrl: `${BASE}iccs/`,
      useSystemFonts: true,
    }).promise;
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") throw new Error("PDF protégé par mot de passe");
    throw new Error("PDF illisible");
  }
  const page: PDFPageProxy = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  return {
    largeurPt: base.width,
    hauteurPt: base.height,
    nbPages: doc.numPages,
    async dessiner(w, h, zone) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const z = zone ?? { x: 0, y: 0, l: 1, h: 1 };
      // Échelle pour que la zone remplisse exactement le canvas ; le décalage amène son coin en (0, 0).
      const echelle = Math.min(w / (z.l * base.width), h / (z.h * base.height));
      const viewport = page.getViewport({ scale: echelle });
      await page.render({
        canvas,
        viewport,
        transform: [1, 0, 0, 1, -z.x * viewport.width, -z.y * viewport.height],
      }).promise;
      return canvas;
    },
  };
}
