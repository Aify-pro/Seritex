/**
 * Films de sérigraphie (lot 2) : un PDF, une page par écran, l'écran en noir
 * à la taille réelle du marquage, avec cibles de calage et légende. Généré
 * dans le navigateur (canvas + pdf-lib), sans envoi du visuel.
 */
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  StandardFonts,
  type PDFPage,
} from "pdf-lib";
import { appliquerEncresPixels, lireZone } from "./client";
import { dimensionsFilms } from "./dimensions-films";
import type { Films, ResultatSeparation } from "./separer";

const MM = 72 / 25.4;
/** Plus petit point qu'un écran imprime de façon fiable (diamètre, mm). */
const POINT_MIN_MM = 0.5;
const MARGE_MM = 20;
const LEGENDE_MM = 28;
const A4: [number, number] = [210, 297];
const A3: [number, number] = [297, 420];

export type OptionsFilms = {
  /** Largeur imprimée du dessin, en cm. */
  largeurCm: number;
  /** Films inversés gauche-droite (émulsion côté écran). */
  miroir: boolean;
  /** Nom du visuel, repris dans la légende. */
  nom: string;
  /** Référence de la demande, si connue. */
  reference?: string | null;
  /** Nom de l'encre retenue pour chaque écran, dans l'ordre des couleurs. */
  encres?: (string | null)[];
  /** Sous-couche blanche (textile foncé) : écran imprimé en premier, rentré sous les couleurs. */
  sousCouche?: { nom: string; rentreMm: number } | null;
};

/**
 * Écran k en masque 1 bit (8 pixels par octet, lignes complétées à l'octet) :
 * bit 0 = encre déposée. C'est le format natif d'un film dans un PDF
 * (/ImageMask), net à toute échelle et bien plus léger qu'une image en gris.
 */
function masqueEcran(f: Films, encre: (p: number) => boolean, miroir: boolean): Uint8Array {
  const parLigne = Math.ceil(f.largeur / 8);
  const out = new Uint8Array(parLigne * f.hauteur).fill(0xff);
  for (let y = 0; y < f.hauteur; y++) {
    const ligne = y * f.largeur;
    for (let x = 0; x < f.largeur; x++) {
      if (!encre(ligne + x)) continue;
      const xs = miroir ? f.largeur - 1 - x : x;
      out[y * parLigne + (xs >> 3)] &= ~(0x80 >> (xs & 7));
    }
  }
  return out;
}

/** Compression zlib (FlateDecode) par le navigateur, bien plus rapide que pdf-lib. */
async function compresser(octets: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const flux = new Blob([octets.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/** Dessine un masque 1 bit en noir, à (x, y) et à la taille (l, h) en points. */
async function dessinerMasque(doc: PDFDocument, page: PDFPage, masque: Uint8Array, f: Films, x: number, y: number, l: number, h: number) {
  const dict = { Type: "XObject", Subtype: "Image", Width: f.largeur, Height: f.hauteur, ImageMask: true, BitsPerComponent: 1 };
  const compresse = await compresser(masque);
  const flux = compresse
    ? doc.context.stream(compresse, { ...dict, Filter: "FlateDecode" })
    : doc.context.flateStream(masque, dict);
  const ref = doc.context.register(flux);
  const nom = page.node.newXObject("Film", ref);
  page.pushOperators(
    pushGraphicsState(),
    setFillingRgbColor(0, 0, 0),
    concatTransformationMatrix(l, 0, 0, h, x, y),
    drawObject(nom),
    popGraphicsState(),
  );
}

/** Plus petit format (A4 puis A3, portrait ou paysage) qui contient le film ; sinon sur mesure. */
function formatPage(lmm: number, hmm: number): [number, number] {
  const besoinL = lmm + 2 * MARGE_MM;
  const besoinH = hmm + 2 * MARGE_MM + LEGENDE_MM;
  for (const [a, b] of [A4, A3]) {
    if (besoinL <= a && besoinH <= b) return [a, b];
    if (besoinL <= b && besoinH <= a) return [b, a];
  }
  return [Math.ceil(besoinL), Math.ceil(besoinH)];
}

/** Cible de calage : cercle et croix, centrée en (x, y) en points. */
function cible(page: PDFPage, x: number, y: number) {
  const noir = rgb(0, 0, 0);
  const r = 3 * MM;
  page.drawCircle({ x, y, size: r, borderColor: noir, borderWidth: 0.5 });
  page.drawLine({ start: { x: x - 2 * r, y }, end: { x: x + 2 * r, y }, thickness: 0.5, color: noir });
  page.drawLine({ start: { x, y: y - 2 * r }, end: { x, y: y + 2 * r }, thickness: 0.5, color: noir });
}

/** Polices standard du PDF : caractères hors Latin-1 remplacés. */
const sur = (s: string) => s.replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\xFF]/g, "?");

const cm = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} cm`;

/**
 * Prépare les films d'une séparation : relit le visuel en pleine résolution,
 * applique les encres retenues et met chaque écran en page à taille réelle.
 */
export async function preparerFilms(
  source: Blob | string,
  r: ResultatSeparation,
  options: OptionsFilms,
  etape: (message: string) => void = () => {},
): Promise<Blob> {
  const dims = dimensionsFilms(r, options.largeurCm);
  etape("Lecture du visuel en pleine résolution…");
  const image = await lireZone(source, dims.zone, dims.largeurPx, dims.hauteurPx);
  etape("Application des encres…");
  const pxParMm = dims.ppp / 25.4;
  const rentrePx = options.sousCouche ? Math.max(1, Math.round(options.sousCouche.rentreMm * pxParMm)) : null;
  const films = await appliquerEncresPixels(image.px, image.w, image.h, r, Math.max(4, Math.round((pxParMm * POINT_MIN_MM) ** 2)), rentrePx);

  const doc = await PDFDocument.create();
  doc.setTitle(sur(`Films ${options.nom}`));
  doc.setCreator("Seritex");
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const lmm = options.largeurCm * 10;
  const hmm = (lmm * films.hauteur) / films.largeur;
  const [pl, ph] = formatPage(lmm, hmm);
  // Écrans dans l'ordre d'impression : la sous-couche d'abord.
  type Ecran = { titre: string; encre: (p: number) => boolean };
  const ecrans: Ecran[] = [];
  if (options.sousCouche && films.sousCouche) {
    const blanc = films.sousCouche;
    ecrans.push({ titre: `Sous-couche · ${options.sousCouche.nom}`, encre: (p) => blanc[p] === 1 });
  }
  r.couleurs.forEach((c, k) => {
    const nomEncre = options.encres?.[k];
    ecrans.push({ titre: nomEncre ? `${nomEncre} · ${c.hex}` : c.hex, encre: (p) => films.indices[p] === k });
  });
  const n = ecrans.length;

  for (let k = 0; k < n; k++) {
    etape(`Écran ${k + 1} sur ${n}…`);
    const page = doc.addPage([pl * MM, ph * MM]);
    const x = ((pl - lmm) / 2) * MM;
    const y = (MARGE_MM + LEGENDE_MM) * MM;
    await dessinerMasque(doc, page, masqueEcran(films, ecrans[k].encre, options.miroir), films, x, y, lmm * MM, hmm * MM);

    // Cibles à 12 mm du dessin, au milieu de chaque côté.
    const e = 12 * MM;
    const cx = x + (lmm * MM) / 2;
    const cy = y + (hmm * MM) / 2;
    cible(page, cx, y + hmm * MM + e);
    cible(page, cx, y - e);
    cible(page, x - e, cy);
    cible(page, x + lmm * MM + e, cy);

    const titre = sur(`Écran ${k + 1} / ${n} · ${ecrans[k].titre}`);
    const detail = sur(
      [
        options.reference,
        options.nom,
        `${cm(options.largeurCm)} × ${cm(hmm / 10)}`,
        `${Math.round(films.largeur / (options.largeurCm / 2.54))} ppp`,
        options.miroir ? "miroir" : null,
        "Seritex",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    page.drawText(titre, { x, y: (MARGE_MM + 4) * MM, size: 11, font: gras });
    page.drawText(detail, { x, y: MARGE_MM * MM - 2, size: 8, font: police });
  }

  const octets = await doc.save();
  return new Blob([octets.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}
