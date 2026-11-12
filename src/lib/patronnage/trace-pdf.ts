import "server-only";
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { DxfContour } from "@/lib/patronnage/dxf";
import { MM_PAR_UNITE, type LignePieceDetail } from "@/lib/patronnage/detail";
import { centroid, type Point } from "@/lib/patronnage/geometry";
import {
  construireContenuCartouche,
  libellePieceMarquee,
  mettreEnPageCartouche,
  placerCartouche,
  type CartoucheInfo,
  type ContenuCartouche,
  type LigneCartouche,
  type OrientationCartouche,
} from "@/lib/patronnage/cartouche";

/**
 * PDF d'un tracé — décision actée le 2026-10-02 : UNE page, le dessin
 * proportionné (jamais déformé) pour y tenir quelle que soit la longueur
 * réelle du tracé (plusieurs mètres, cf. dxf.ts), PAS à l'échelle 1:1. Jamais
 * un support de coupe (ce rôle reste au DXF, surchargé sans jamais être
 * redessiné — cf. dxf-export.ts) : un document de consultation/archivage,
 * qui le dit explicitement (case « hors échelle » + ratio approximatif), et
 * qui écrit les dimensions RÉELLES (mm) sur chaque pièce en version marquée
 * pour que « respecter les tailles » reste vrai malgré la mise à l'échelle
 * de la page.
 *
 * Les contours SONT redessinés ici depuis les contours déjà analysés
 * (contrairement au DXF marqué, qui ne fait que surcharger l'original) :
 * acceptable uniquement parce que ce PDF n'ira jamais guider une découpe —
 * l'approximation des arcs en segments droits (limite connue de dxf.ts)
 * n'a donc pas la même conséquence que pour le fichier remis au traceur.
 *
 * Repère : les coordonnées du fichier ET celles de pdf-lib pointent toutes
 * les deux vers le haut (Y croissant) — contrairement à une image/un SVG —
 * donc AUCUN flip n'est nécessaire pour les contours/texte, seule la
 * conversion unité → point (cf. PT_PAR_UNITE). Seul le QR (matriciel, rangée
 * 0 = haut du symbole, convention image) a besoin de son propre retournement
 * local, même logique que dxf-export.ts.
 */

const PT_PAR_MM = 72 / 25.4;
const PT_PAR_UNITE = MM_PAR_UNITE * PT_PAR_MM; // points, à l'échelle physique réelle, par unité de fichier

const PAGE_GRAND_COTE_MM = 420; // A3
const PAGE_PETIT_COTE_MM = 297;
const MARGE_MM = 14;
const ESPACE_TRACE_CARTOUCHE_MM = 10;
const ESPACE_NOTE_ECHELLE_MM = 7;

const NOIR = rgb(0.08, 0.08, 0.08);
const GRIS = rgb(0.55, 0.55, 0.55);
const ROUGE = rgb(0.72, 0.11, 0.11);
const VERT = rgb(0.08, 0.47, 0.18);

const TAILLE_LABEL_PIECE_PT = 6.5;
const TAILLE_DIM_PIECE_PT = 5;
const TAILLE_TITRE_PT = 11;
const TAILLE_CORPS_PT = 7.5;
const QR_TAILLE_MM = 28;
const CARTOUCHE_PADDING_MM = 5;

export interface OptionsMarquagePdf {
  lignes: LignePieceDetail[];
  info: CartoucheInfo;
  orientation: OrientationCartouche;
}

/**
 * PDF d'un tracé. Sans marquage : aperçu sur une feuille (hors échelle, cf.
 * ci-dessus). Avec marquage (2026-11-11) : en TAILLE RÉELLE, comme le DXF
 * marqué, pour être remis à l'imprimeur (cf. genererTracePdfReel).
 */
export async function genererTracePdf(
  contours: DxfContour[],
  marquage: OptionsMarquagePdf | null
): Promise<{ pdf: Uint8Array } | { error: string }> {
  if (marquage) return genererTracePdfReel(contours, marquage);
  return genererTracePdfApercu(contours, null);
}

/** Taille maximale d'une page PDF (200 pouces) : au-delà, la page passe par /UserUnit. */
const PAGE_MAX_PT = 14400;
const MARGE_REELLE_MM = 10;
const HAUTEUR_TEXTE_PIECE_MM = 5;
const HAUTEUR_DIM_PIECE_MM = 3;

/**
 * PDF marqué en taille réelle (1:1) : contours, étiquette de chaque pièce
 * (sans accent ni caractère spécial, police réduite) et cartouche au bout de
 * la longueur, tourné de 90° le long de la largeur — même mise en page que le
 * DXF marqué (cartouche.ts). Une page plus grande que 200 pouces (5,08 m,
 * limite des PDF) est décrite avec /UserUnit : le document reste à l'échelle
 * réelle pour une visionneuse ou un logiciel d'impression qui la respecte.
 */
async function genererTracePdfReel(contours: DxfContour[], marquage: OptionsMarquagePdf): Promise<{ pdf: Uint8Array } | { error: string }> {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { error: "Tracé vide : rien à représenter." };

  const enMm = (v: number) => v * MM_PAR_UNITE;
  const boite = { minX: enMm(minX), minY: enMm(minY), maxX: enMm(maxX), maxY: enMm(maxY) };
  const contenu = construireContenuCartouche(marquage.lignes, marquage.info);
  const miseEnPage = mettreEnPageCartouche(contenu, marquage.orientation, Math.min(boite.maxX - boite.minX, boite.maxY - boite.minY));
  const place = placerCartouche(boite, miseEnPage);
  const coins = [place.versTrace(0, 0), place.versTrace(miseEnPage.largeurMm, miseEnPage.hauteurMm)];
  const x0 = Math.min(boite.minX, ...coins.map((c) => c[0])) - MARGE_REELLE_MM;
  const y0 = Math.min(boite.minY, ...coins.map((c) => c[1])) - MARGE_REELLE_MM;
  const x1 = Math.max(boite.maxX, ...coins.map((c) => c[0])) + MARGE_REELLE_MM;
  const y1 = Math.max(boite.maxY, ...coins.map((c) => c[1])) + MARGE_REELLE_MM;

  const largeurPt = (x1 - x0) * PT_PAR_MM;
  const hauteurPt = (y1 - y0) * PT_PAR_MM;
  const userUnit = Math.max(1, Math.ceil(Math.max(largeurPt, hauteurPt) / PAGE_MAX_PT));
  const pt = (mm: number) => (mm * PT_PAR_MM) / userUnit;
  const versPage = ([x, y]: [number, number]): [number, number] => [pt(x - x0), pt(y - y0)];

  const pdf = await PDFDocument.create();
  pdf.setProducer("Seritex");
  pdf.setTitle(`Trace marque ${contenu.qrLegende} - taille reelle`);
  const police = await pdf.embedFont(StandardFonts.Helvetica);
  const policeGrasse = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([largeurPt / userUnit, hauteurPt / userUnit]);
  if (userUnit > 1) page.node.set(PDFName.of("UserUnit"), PDFNumber.of(userUnit));

  // Hauteur de texte en mm (hauteur des majuscules) → taille de police.
  const taillePolice = (hauteurMm: number) => pt(hauteurMm / 0.72);

  const lignesParIndex = new Map(marquage.lignes.map((l) => [l.index, l]));
  for (let i = 0; i < contours.length; i++) {
    const nonReconnue = lignesParIndex.get(i)?.reconnue === false;
    const versP = (p: Point) => versPage([enMm(p[0]), enMm(p[1])]);
    dessinerContour(page, contours[i].points.map(versP), nonReconnue ? ROUGE : NOIR, pt(0.3));
    for (const interieur of contours[i].interieurs) dessinerContour(page, interieur.map(versP), GRIS, pt(0.2));
  }

  for (const ligne of marquage.lignes) {
    const points = contours[ligne.index]?.points;
    if (!points || points.length < 3) continue;
    const [cx, cy] = versPage([enMm(centroid(points)[0]), enMm(centroid(points)[1])]);
    const xs = points.map((p) => p[0]);
    const largeurPiece = pt(enMm(Math.max(...xs) - Math.min(...xs))) * 0.9;
    const texte = libellePieceMarquee(ligne);
    const couleur = ligne.reconnue ? NOIR : ROUGE;
    const taille = fitSize(texte, policeGrasse, taillePolice(HAUTEUR_TEXTE_PIECE_MM), largeurPiece, taillePolice(1.5));
    if (policeGrasse.widthOfTextAtSize(texte, taille) <= largeurPiece) {
      centerText(page, texte, cx, cy, policeGrasse, taille, couleur);
      const dim = `${ligne.largeurMm} x ${ligne.hauteurMm} mm`;
      centerText(page, dim, cx, cy - taille * 1.3, police, Math.min(taille * 0.7, taillePolice(HAUTEUR_DIM_PIECE_MM)), GRIS);
    } else if (!ligne.reconnue) {
      centerText(page, "NR", cx, cy, policeGrasse, taillePolice(HAUTEUR_TEXTE_PIECE_MM), ROUGE);
    }
  }

  // Cartouche, même mise en page que le DXF.
  const versPageLocal = (u: number, v: number) => versPage(place.versTrace(u, v));
  const rectLocal = (u0: number, v0: number, u1: number, v1: number) => {
    const a = versPageLocal(u0, v0);
    const b = versPageLocal(u1, v1);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
  };
  for (const el of miseEnPage.elements) {
    if (el.type === "cadre") {
      page.drawRectangle({ ...rectLocal(el.u0, el.v0, el.u1, el.v1), borderColor: VERT, borderWidth: pt(0.4) });
    } else if (el.type === "qr") {
      const qr = QRCode.create(el.url, { errorCorrectionLevel: "M" });
      const n = qr.modules.size;
      const m = el.taille / n;
      for (let row = 0; row < n; row++) {
        let col = 0;
        while (col < n) {
          if (!qr.modules.get(row, col)) {
            col++;
            continue;
          }
          const debut = col;
          while (col < n && qr.modules.get(row, col)) col++;
          const vHaut = el.v0 + el.taille - row * m;
          page.drawRectangle({ ...rectLocal(el.u0 + debut * m, vHaut - m, el.u0 + col * m, vHaut), color: NOIR });
        }
      }
    } else {
      const f = el.accent === "titre" ? policeGrasse : police;
      const taille = taillePolice(el.hauteur);
      const decalageU = el.centre ? f.widthOfTextAtSize(el.texte, taille) / (pt(1)) / 2 : 0;
      const [x, y] = versPageLocal(el.u - decalageU, el.v);
      const couleur = el.accent === "verdict_ok" ? VERT : el.accent === "verdict_ko" ? ROUGE : NOIR;
      page.drawText(el.texte, { x, y, size: taille, font: f, color: couleur, rotate: degrees(place.rotation) });
    }
  }

  page.drawText("Echelle 1:1 - imprimer a 100 %, sans ajustement a la page", {
    x: pt(2),
    y: pt(2),
    size: taillePolice(2.5),
    font: police,
    color: GRIS,
  });
  return { pdf: await pdf.save() };
}

async function genererTracePdfApercu(
  contours: DxfContour[],
  marquage: OptionsMarquagePdf | null
): Promise<{ pdf: Uint8Array } | { error: string }> {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { error: "Tracé vide : rien à représenter." };

  const largeurTracePt = (maxX - minX) * PT_PAR_UNITE;
  const hauteurTracePt = (maxY - minY) * PT_PAR_UNITE;

  const pdf = await PDFDocument.create();
  pdf.setProducer("Seritex");
  const police = await pdf.embedFont(StandardFonts.Helvetica);
  const policeGrasse = await pdf.embedFont(StandardFonts.HelveticaBold);

  const contenu = marquage ? construireContenuCartouche(marquage.lignes, marquage.info) : null;
  pdf.setTitle(marquage ? `Tracé marqué — ${marquage.info.traceReference}` : "Tracé — sans marquage");

  // Cartouche dimensionné à son CONTENU réel (largeurs de texte mesurées via
  // la police embarquée) : contrairement au DXF, aucune contrainte de laize
  // ne s'applique ici — ce PDF ne va jamais à un traceur.
  const cartouche = contenu ? dimensionsCartouche(contenu, marquage!.orientation, police, policeGrasse) : null;

  const largeurTotalePt = Math.max(largeurTracePt, cartouche?.largeurPt ?? 0);
  const hauteurTotalePt =
    hauteurTracePt + (cartouche ? ESPACE_TRACE_CARTOUCHE_MM * PT_PAR_MM + cartouche.hauteurPt : 0) + ESPACE_NOTE_ECHELLE_MM * PT_PAR_MM;

  const paysage = largeurTotalePt >= hauteurTotalePt;
  const pageWpt = (paysage ? PAGE_GRAND_COTE_MM : PAGE_PETIT_COTE_MM) * PT_PAR_MM;
  const pageHpt = (paysage ? PAGE_PETIT_COTE_MM : PAGE_GRAND_COTE_MM) * PT_PAR_MM;
  const page = pdf.addPage([pageWpt, pageHpt]);

  const margePt = MARGE_MM * PT_PAR_MM;
  const zoneW = pageWpt - 2 * margePt;
  const zoneH = pageHpt - 2 * margePt;
  const echelle = Math.min(zoneW / largeurTotalePt, zoneH / hauteurTotalePt);

  // Composition centrée horizontalement sur la page.
  const largeurDessineePt = largeurTotalePt * echelle;
  const xOrigine = margePt + (zoneW - largeurDessineePt) / 2;
  let yCurseur = pageHpt - margePt; // on empile du HAUT vers le bas

  // --- Tracé : transforme un point FICHIER (unités brutes) en point PDF,
  // en englobant la mise à l'échelle page ET le décalage d'origine — un seul
  // endroit, jamais de flip (cf. en-tête : les deux repères pointent vers le haut).
  const yHautTrace = yCurseur;
  const transform = ([x, y]: Point): [number, number] => [
    xOrigine + (x - minX) * PT_PAR_UNITE * echelle,
    yHautTrace - (maxY - y) * PT_PAR_UNITE * echelle,
  ];

  const lignesParIndex = new Map(marquage?.lignes.map((l) => [l.index, l]));
  for (let i = 0; i < contours.length; i++) {
    const estNonReconnue = marquage ? lignesParIndex.get(i)?.reconnue === false : false;
    dessinerContour(page, contours[i].points.map(transform), estNonReconnue ? ROUGE : NOIR, 1.1);
    for (const interieur of contours[i].interieurs) dessinerContour(page, interieur.map(transform), GRIS, 0.6);
  }

  // Sur un tracé réel, beaucoup de petites pièces non reconnues peuvent se
  // retrouver côte à côte (constaté sur un tracé réel du module) : écrire
  // leur étiquette complète à taille fixe les ferait se chevaucher en un
  // magma illisible. Chaque étiquette RÉTRÉCIT d'abord pour tenir dans sa
  // propre pièce ; si même la taille plancher ne tient pas, une pièce
  // RECONNUE passe sous silence (son contour noir suffit, rien d'anormal à
  // signaler), mais une pièce NON RECONNUE garde toujours un repère visible
  // (« NR ») — jamais totalement muette sur un document de contrôle.
  let abreviationUtilisee = false;
  if (marquage) {
    for (const ligne of marquage.lignes) {
      const points = contours[ligne.index]?.points;
      if (!points || points.length < 3) continue;
      const [cx, cy] = transform(centroid(points));
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const pieceW = (Math.max(...xs) - Math.min(...xs)) * PT_PAR_UNITE * echelle;
      const pieceH = (Math.max(...ys) - Math.min(...ys)) * PT_PAR_UNITE * echelle;
      const margeTexte = pieceW * 0.9;

      const texte =
        ligne.reconnue && ligne.patron
          ? `${ligne.patron.articleCode} · ${ligne.patron.size} · ${ligne.patron.pieceName}${ligne.enMiroir ? " (miroir)" : ""}`
          : "NON RECONNUE";
      const couleur = ligne.reconnue ? NOIR : ROUGE;
      const tailleLabel = fitSize(texte, policeGrasse, TAILLE_LABEL_PIECE_PT, margeTexte, 3.2);

      if (policeGrasse.widthOfTextAtSize(texte, tailleLabel) <= margeTexte && pieceH > tailleLabel * 3) {
        centerText(page, texte, cx, cy + 2, policeGrasse, tailleLabel, couleur);
        const texteDim = `${ligne.largeurMm} × ${ligne.hauteurMm} mm`;
        const tailleDim = fitSize(texteDim, police, TAILLE_DIM_PIECE_PT, margeTexte, 3);
        if (police.widthOfTextAtSize(texteDim, tailleDim) <= margeTexte) {
          centerText(page, texteDim, cx, cy - tailleLabel, police, tailleDim, GRIS);
        }
      } else if (!ligne.reconnue) {
        abreviationUtilisee = true;
        const tailleNr = fitSize("NR", policeGrasse, TAILLE_LABEL_PIECE_PT, margeTexte, 2.5);
        centerText(page, "NR", cx, cy - tailleNr / 2, policeGrasse, tailleNr, ROUGE);
      }
    }
  }

  yCurseur = yHautTrace - hauteurTracePt * echelle - ESPACE_TRACE_CARTOUCHE_MM * PT_PAR_MM * echelle;

  // --- Note d'échelle : sur TOUS les documents, sans exception — jamais
  // laisser croire qu'un dessin mis à l'échelle de la page est en vraie
  // grandeur.
  const ratio = echelle < 1 ? `environ 1/${Math.round(1 / echelle)}` : `environ ×${Math.round(echelle)}`;
  const noteEchelle = marquage
    ? `Document hors échelle (${ratio}) — dimensions réelles indiquées en mm sur chaque pièce.${
        abreviationUtilisee ? " « NR » : pièce non reconnue trop petite pour l'étiquette complète, voir la plateforme." : ""
      }`
    : `Document hors échelle (${ratio}) — pour les dimensions réelles, voir le DXF ou la version marquée.`;
  page.drawText(noteEchelle, { x: xOrigine, y: yCurseur - 9, size: 7, font: police, color: GRIS });

  if (contenu && cartouche) {
    const yCartoucheHaut = yCurseur - ESPACE_NOTE_ECHELLE_MM * PT_PAR_MM;
    await dessinerCartouche(
      page,
      contenu,
      marquage!.orientation,
      xOrigine,
      yCartoucheHaut,
      cartouche,
      police,
      policeGrasse
    );
  }

  return { pdf: await pdf.save() };
}

interface DimensionsCartouchePt {
  largeurPt: number;
  hauteurPt: number;
}

function dimensionsCartouche(
  contenu: ContenuCartouche,
  orientation: OrientationCartouche,
  police: PDFFont,
  policeGrasse: PDFFont
): DimensionsCartouchePt {
  const pad = CARTOUCHE_PADDING_MM * PT_PAR_MM;
  const qrTaille = QR_TAILLE_MM * PT_PAR_MM;
  const policeDe = (l: LigneCartouche) => (l.accent === "titre" ? policeGrasse : police);
  const tailleDe = (l: LigneCartouche) => (l.accent === "titre" ? TAILLE_TITRE_PT : TAILLE_CORPS_PT);
  const hauteurLigne = (l: LigneCartouche) => tailleDe(l) + 4;
  const largeurLignePlusLongue = Math.max(...contenu.lignes.map((l) => policeDe(l).widthOfTextAtSize(l.texte, tailleDe(l))));
  const hauteurTexte = contenu.lignes.reduce((s, l) => s + hauteurLigne(l), 0);

  if (orientation === "horizontal") {
    return {
      largeurPt: pad * 3 + qrTaille + largeurLignePlusLongue,
      hauteurPt: pad * 2 + Math.max(qrTaille, hauteurTexte),
    };
  }
  return {
    largeurPt: Math.max(qrTaille + pad * 2, largeurLignePlusLongue + pad * 2),
    hauteurPt: pad * 3 + qrTaille + 12 + hauteurTexte,
  };
}

async function dessinerCartouche(
  page: PDFPage,
  contenu: ContenuCartouche,
  orientation: OrientationCartouche,
  x0: number,
  yHaut: number,
  dims: DimensionsCartouchePt,
  police: PDFFont,
  policeGrasse: PDFFont
) {
  const pad = CARTOUCHE_PADDING_MM * PT_PAR_MM;
  const qrTaille = QR_TAILLE_MM * PT_PAR_MM;
  const y0 = yHaut - dims.hauteurPt;

  page.drawRectangle({ x: x0, y: y0, width: dims.largeurPt, height: dims.hauteurPt, borderColor: VERT, borderWidth: 1.2 });

  const policeDe = (l: LigneCartouche) => (l.accent === "titre" ? policeGrasse : police);
  const tailleDe = (l: LigneCartouche) => (l.accent === "titre" ? TAILLE_TITRE_PT : TAILLE_CORPS_PT);
  const couleurDe = (l: LigneCartouche) => (l.accent === "verdict_ok" ? VERT : l.accent === "verdict_ko" ? ROUGE : NOIR);

  if (orientation === "horizontal") {
    await dessinerQr(page, contenu.qrUrl, x0 + pad, y0 + pad, qrTaille);
    centerText(page, contenu.qrLegende, x0 + pad + qrTaille / 2, y0 + pad / 2 - 2, police, 6, GRIS);

    const xTexte = x0 + pad * 2 + qrTaille;
    let curY = yHaut - pad - tailleDe(contenu.lignes[0]);
    for (const l of contenu.lignes) {
      page.drawText(l.texte, { x: xTexte, y: curY, size: tailleDe(l), font: policeDe(l), color: couleurDe(l) });
      curY -= tailleDe(l) + 4;
    }
  } else {
    const xCentre = x0 + dims.largeurPt / 2;
    await dessinerQr(page, contenu.qrUrl, xCentre - qrTaille / 2, yHaut - pad - qrTaille, qrTaille);
    centerText(page, contenu.qrLegende, xCentre, yHaut - pad - qrTaille - 10, police, 6, GRIS);

    let curY = yHaut - pad - qrTaille - 20 - tailleDe(contenu.lignes[0]);
    for (const l of contenu.lignes) {
      page.drawText(l.texte, { x: x0 + pad, y: curY, size: tailleDe(l), font: policeDe(l), color: couleurDe(l) });
      curY -= tailleDe(l) + 4;
    }
  }
}

/** Contour fermé, segment par segment — jamais déformé : conversion unité → point déjà appliquée par l'appelant (`transform`). */
function dessinerContour(page: PDFPage, points: [number, number][], couleur: ReturnType<typeof rgb>, epaisseur: number) {
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: epaisseur, color: couleur });
  }
}

function centerText(page: PDFPage, texte: string, cx: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  page.drawText(texte, { x: cx - font.widthOfTextAtSize(texte, size) / 2, y, size, font, color });
}

/** Réduit la police jusqu'à ce que le texte tienne dans la largeur, sans descendre sous `floor` (même principe que waste-bag-label.ts). */
function fitSize(texte: string, font: PDFFont, preferred: number, maxWidth: number, floor: number): number {
  let size = preferred;
  while (size > floor && font.widthOfTextAtSize(texte, size) > maxWidth) size -= 0.5;
  return size;
}

/**
 * QR dessiné module par module en rectangles vectoriels pleins — jamais une
 * image collée (rééchantillonnage flou à l'impression) : même convention que
 * les étiquettes de sacs de déchets (waste-bag-label.ts) et le marquage DXF
 * (dxf-export.ts). Rangée 0 = haut du symbole (lecture normale).
 */
async function dessinerQr(page: PDFPage, url: string, x0: number, y0: number, taille: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const tailleModule = taille / count;
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const debut = col;
      while (col < count && qr.modules.get(row, col)) col++;
      const yHaut = y0 + taille - row * tailleModule;
      page.drawRectangle({
        x: x0 + debut * tailleModule,
        y: yHaut - tailleModule,
        width: (col - debut) * tailleModule,
        height: tailleModule,
        color: NOIR,
      });
    }
  }
}
