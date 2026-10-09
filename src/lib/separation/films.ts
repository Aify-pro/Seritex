/**
 * Films de sérigraphie (lots 2 et 5) : un PDF, une page par écran, l'écran en
 * noir à la taille réelle du marquage, avec cibles de calage et légende, selon
 * le rendu choisi (aplats, diffusion, Bayer, trame AM). Généré dans le
 * navigateur (Web Worker + pdf-lib), sans envoi du visuel.
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
import { ecransFilmsPixels, lireZone } from "./client";
import { dimensionsFilms, PPP_FILMS } from "./dimensions-films";
import type { ResultatSeparation } from "./separer";
import { ENCRES_CMJN, type Rendu } from "./trame";
import type { ReglagesImage } from "./image";
import { modeSousCouche, type OptionsSousCouche } from "./sous-couche";

const MM = 72 / 25.4;
/** Plus petit point qu'un écran imprime de façon fiable (côté, mm), par défaut. */
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
  /** Sous-couche blanche (textile foncé) : écran imprimé en premier, rentré sous les couleurs ; options et rehaut. */
  sousCouche?: { nom: string; rentreMm: number; options?: OptionsSousCouche } | null;
  /** Rendu des écrans (défaut : aplats). */
  rendu?: Rendu;
  /** Résolution visée des films, points par pouce (défaut 360). */
  ppp?: number;
  /** Îlots plus petits retirés (aplats), côté en mm (défaut 0,5). */
  pointMinMm?: number;
  /** Recouvrement des encres claires sous les foncées (aplats), mm (défaut 0). */
  recouvrementMm?: number;
  /** Réglages manuels de l'image (lot 7). */
  image?: ReglagesImage;
  /** Largeur de l'image d'analyse en pixels (échelle de la netteté et du bruit). */
  largeurAnalyse?: number;
};

/** Résumé du rendu pour la légende d'un écran (k : index de couleur, -1 : sous-couche). */
function legendeRendu(rendu: Rendu, k: number) {
  if (k < 0) return null;
  if (rendu.type === "am" || rendu.type === "cmjn") {
    const angle = rendu.angles[k < 0 ? 0 : k] ?? rendu.angles[0] ?? 22.5;
    return `${rendu.type === "cmjn" ? "quadri" : "trame AM"} ${rendu.lpi} lpi · ${angle.toLocaleString("fr-FR")}° · point ${rendu.forme}`;
  }
  if (rendu.type === "diffusion") return `diffusion ${rendu.algo}`;
  if (rendu.type === "bayer") return `Bayer ${rendu.maillage} fils/cm`;
  return null;
}

/** Compression zlib (FlateDecode) par le navigateur, bien plus rapide que pdf-lib. */
async function compresser(octets: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const flux = new Blob([octets.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/** Dessine un masque 1 bit en noir, à (x, y) et à la taille (l, h) en points. */
async function dessinerMasque(doc: PDFDocument, page: PDFPage, masque: Uint8Array, f: { largeur: number; hauteur: number }, x: number, y: number, l: number, h: number) {
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

const cmjnRendu = (r: Rendu) => r.type === "cmjn";

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
  const rendu: Rendu = options.rendu ?? { type: "aplat" };
  const dims = dimensionsFilms(r, options.largeurCm, options.ppp ?? PPP_FILMS);
  etape("Lecture du visuel en pleine résolution…");
  const image = await lireZone(source, dims.zone, dims.largeurPx, dims.hauteurPx);
  etape(rendu.type === "am" || cmjnRendu(rendu) ? "Trame des écrans…" : "Application des encres…");
  const pxParMm = dims.ppp / 25.4;
  const cmjn = rendu.type === "cmjn";
  const films = await ecransFilmsPixels(image.px, image.w, image.h, {
    encres: cmjn ? ENCRES_CMJN.map((e) => e.hex) : r.couleurs.map((c) => c.hex),
    image: options.image,
    echelleImage: image.w / Math.max(1, dims.zone.l * (options.largeurAnalyse ?? r.largeur)),
    fond: r.fond,
    transparent: r.transparent,
    rendu,
    ppp: dims.ppp,
    pixelsMin: Math.max(4, Math.round((pxParMm * (options.pointMinMm ?? POINT_MIN_MM)) ** 2)),
    recouvrementPx: Math.round((options.recouvrementMm ?? 0) * pxParMm),
    sousCouche: options.sousCouche
      ? { rentrePx: Math.max(1, Math.round(options.sousCouche.rentreMm * pxParMm)), options: options.sousCouche.options }
      : null,
    miroir: options.miroir,
  });

  const doc = await PDFDocument.create();
  doc.setTitle(sur(`Films ${options.nom}`));
  doc.setCreator("Seritex");
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const lmm = options.largeurCm * 10;
  const hmm = (lmm * films.hauteur) / films.largeur;
  const [pl, ph] = formatPage(lmm, hmm);
  // Écrans dans l'ordre d'impression : la sous-couche d'abord (même ordre que films.ecrans).
  const titres: { titre: string; k: number }[] = [];
  const blancs = options.sousCouche?.options;
  if (options.sousCouche) {
    const tramee = blancs ? modeSousCouche(blancs, rendu.type) === "tramee" : rendu.type === "am" || rendu.type === "cmjn";
    titres.push({
      titre: `Sous-couche · ${options.sousCouche.nom}${tramee ? ` (tramée${blancs ? ` ${blancs.trame.lpi} lpi · ${blancs.trame.angle.toLocaleString("fr-FR")}°` : ""})` : " (aplat)"}`,
      k: -1,
    });
  }
  if (cmjn) ENCRES_CMJN.forEach((c, k) => titres.push({ titre: `${c.nom} (quadrichromie)`, k }));
  else
    r.couleurs.forEach((c, k) => {
      const nomEncre = options.encres?.[k];
      titres.push({ titre: nomEncre ? `${nomEncre} · ${c.hex}` : c.hex, k });
    });
  if (options.sousCouche && blancs?.rehaut.actif) titres.push({ titre: `Rehaut · ${options.sousCouche.nom} (hautes lumières, imprimé en dernier)`, k: -2 });
  const n = films.ecrans.length;

  for (let k = 0; k < n; k++) {
    etape(`Écran ${k + 1} sur ${n}…`);
    const page = doc.addPage([pl * MM, ph * MM]);
    const x = ((pl - lmm) / 2) * MM;
    const y = (MARGE_MM + LEGENDE_MM) * MM;
    await dessinerMasque(doc, page, films.ecrans[k], films, x, y, lmm * MM, hmm * MM);

    // Cibles à 12 mm du dessin, au milieu de chaque côté.
    const e = 12 * MM;
    const cx = x + (lmm * MM) / 2;
    const cy = y + (hmm * MM) / 2;
    cible(page, cx, y + hmm * MM + e);
    cible(page, cx, y - e);
    cible(page, x - e, cy);
    cible(page, x + lmm * MM + e, cy);

    const titre = sur(`Écran ${k + 1} / ${n} · ${titres[k]?.titre ?? ""}`);
    const detail = sur(
      [
        options.reference,
        options.nom,
        `${cm(options.largeurCm)} × ${cm(hmm / 10)}`,
        `${Math.round(films.largeur / (options.largeurCm / 2.54))} ppp`,
        legendeRendu(rendu, titres[k]?.k ?? 0),
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
