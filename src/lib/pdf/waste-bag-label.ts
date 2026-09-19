import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode, { type QRCode as QrSymbol } from "qrcode";

/**
 * Étiquette d'un sac de déchets, en PDF — deux supports :
 *
 * - `thermique` : une page = une étiquette de 52 mm de large, pour une
 *   imprimante thermique à rouleau. La page fait exactement la taille de
 *   l'étiquette : le pilote de l'imprimante n'a rien à mettre à l'échelle,
 *   et c'est la mise à l'échelle qui rend un QR illisible.
 * - `a4` : planche de 3 × 4 étiquettes de même format (52 × 60 mm), avec
 *   traits de coupe, pour une imprimante de bureau.
 *
 * Le QR est dessiné module par module en rectangles vectoriels, pas collé en
 * image : une tête thermique à 203 dpi rééchantillonnerait une image et
 * baverait les bords des modules, un tracé vectoriel reste net à toute
 * résolution. Noir pur uniquement, pour la même raison (pas de gris sur une
 * thermique).
 *
 * Le QR encode la même URL que celui affiché à l'écran
 * (`/dechets/<code>`) : c'est ce que reconnaissent le lecteur du terminal de
 * section et un téléphone quelconque.
 */

export type WasteBagLabelData = {
  code: string;
  /** URL absolue de la fiche du sac — encodée dans le QR. */
  url: string;
  /** Déjà formatée (ex. « 18/09/2026 »). */
  createdAt: string;
  /** Présent seulement pour un sac scellé (ex. « Scellé — 18,6 kg »). */
  sealedLine?: string | null;
};

export type WasteBagLabelFormat = "thermique" | "a4";

const MM = 72 / 25.4;

/** Format d'une étiquette, identique en thermique et sur la planche A4. */
const LABEL_W = 52 * MM;
const LABEL_H = 60 * MM;

/** Planche A4 : 3 colonnes × 4 lignes. */
const A4_W = 210 * MM;
const A4_H = 297 * MM;
const A4_COLS = 3;
const A4_ROWS = 4;
const A4_GAP_X = 8 * MM;
const A4_GAP_Y = 6 * MM;
export const A4_MAX_COPIES = A4_COLS * A4_ROWS;

const BLACK = rgb(0, 0, 0);

export async function buildWasteBagLabelPdf(
  data: WasteBagLabelData,
  format: WasteBagLabelFormat,
  copies = A4_MAX_COPIES
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Étiquette ${data.code}`);
  pdf.setCreator("Seritex");

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.CourierBold),
  };
  // Niveau M : ~15 % de redondance, assez pour un sac froissé ou une
  // étiquette un peu rayée, sans grossir inutilement les modules.
  const qr = QRCode.create(data.url, { errorCorrectionLevel: "M" });

  if (format === "thermique") {
    const page = pdf.addPage([LABEL_W, LABEL_H]);
    drawLabel(page, 0, 0, data, qr, fonts);
  } else {
    const page = pdf.addPage([A4_W, A4_H]);
    const n = Math.min(Math.max(1, Math.floor(copies)), A4_MAX_COPIES);
    for (let i = 0; i < n; i++) {
      const { x, y } = gridCell(i);
      drawCutMarks(page, x, y);
      drawLabel(page, x, y, data, qr, fonts);
    }
  }

  return pdf.save();
}

/**
 * Planche A4 de plusieurs sacs différents — un QR chacun, jusqu'à
 * `A4_MAX_COPIES` par page, pagination automatique au-delà. Sert le menu
 * principal des sacs de déchets : générer d'un coup les étiquettes de tous
 * les sacs en cours, à découper.
 */
export async function buildWasteBagsSheetPdf(bags: WasteBagLabelData[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Étiquettes des sacs de déchets");
  pdf.setCreator("Seritex");

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.CourierBold),
  };

  for (let i = 0; i < bags.length; i += A4_MAX_COPIES) {
    const page = pdf.addPage([A4_W, A4_H]);
    const slice = bags.slice(i, i + A4_MAX_COPIES);
    slice.forEach((bag, idx) => {
      const qr = QRCode.create(bag.url, { errorCorrectionLevel: "M" });
      const { x, y } = gridCell(idx);
      drawCutMarks(page, x, y);
      drawLabel(page, x, y, bag, qr, fonts);
    });
  }

  return pdf.save();
}

/** Étiquette générique de la planche A4 : SERITEX, QR, puis trois lignes de texte (grosse, moyenne, petite). */
export type SheetLabel = { url: string; lines: [string, string, string] };

/**
 * Planche A4 d'étiquettes 52 × 60 mm à trois lignes de texte, même grille et
 * même QR vectoriel que les étiquettes de sacs. Sert les étiquettes de lot de
 * la Coupe (sous-ODF, taille et quantité, date), une par taille.
 */
export async function buildLabelSheetPdf(labels: SheetLabel[], title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Seritex");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.CourierBold),
  };

  for (let i = 0; i < labels.length; i += A4_MAX_COPIES) {
    const page = pdf.addPage([A4_W, A4_H]);
    labels.slice(i, i + A4_MAX_COPIES).forEach((label, idx) => {
      const { x, y } = gridCell(idx);
      const cx = x + LABEL_W / 2;
      const maxW = LABEL_W - 6 * MM;
      const [big, medium, small] = label.lines;
      drawCutMarks(page, x, y);

      let cursor = y + LABEL_H - 2.5 * MM - 5 * MM;
      centerText(page, "SERITEX", cx, cursor, fonts.bold, 14);
      const qrSize = 32 * MM;
      cursor -= 2.5 * MM + qrSize;
      drawQr(page, QRCode.create(label.url, { errorCorrectionLevel: "M" }), cx - qrSize / 2, cursor, qrSize);
      cursor -= 5.5 * MM;
      centerText(page, big, cx, cursor, fonts.mono, fitSize(big, fonts.mono, 11, maxW));
      cursor -= 4.5 * MM;
      centerText(page, medium, cx, cursor, fonts.bold, fitSize(medium, fonts.bold, 9, maxW));
      cursor -= 4 * MM;
      centerText(page, small, cx, cursor, fonts.regular, fitSize(small, fonts.regular, 8, maxW));
    });
  }

  return pdf.save();
}

/** Date au format compact utilisé sur les étiquettes (ex. « 18/09/2026 »). */
export function formatLabelDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(value)
  );
}

/** Position (coin bas-gauche) de la cellule `index` (0-based) dans la grille 3 × 4 de la planche A4. */
function gridCell(index: number): { x: number; y: number } {
  const gridW = A4_COLS * LABEL_W + (A4_COLS - 1) * A4_GAP_X;
  const gridH = A4_ROWS * LABEL_H + (A4_ROWS - 1) * A4_GAP_Y;
  const left = (A4_W - gridW) / 2;
  const top = A4_H - (A4_H - gridH) / 2;
  const col = index % A4_COLS;
  const row = Math.floor(index / A4_COLS);
  return { x: left + col * (LABEL_W + A4_GAP_X), y: top - (row + 1) * LABEL_H - row * A4_GAP_Y };
}

function drawLabel(
  page: PDFPage,
  x: number,
  y: number,
  data: WasteBagLabelData,
  qr: QrSymbol,
  fonts: { regular: PDFFont; bold: PDFFont; mono: PDFFont }
) {
  const cx = x + LABEL_W / 2;
  let cursor = y + LABEL_H - 2.5 * MM;

  // En-tête
  cursor -= 2.5 * MM;
  centerText(page, "SERITEX · SAC DE DÉCHETS", cx, cursor, fonts.bold, 7);

  // QR — 3 mm de blanc au-dessus et en dessous : un texte collé au QR mord
  // sur sa zone de silence et fait échouer les lecteurs les moins tolérants.
  const qrSize = 36 * MM;
  cursor -= 3 * MM + qrSize;
  drawQr(page, qr, cx - qrSize / 2, cursor, qrSize);

  // Code du sac — ce qu'on lit à l'œil quand le scan ne passe pas.
  cursor -= 6 * MM;
  centerText(page, data.code, cx, cursor, fonts.mono, fitSize(data.code, fonts.mono, 12, LABEL_W - 6 * MM));

  // Date / scellage
  cursor -= 3.8 * MM;
  const infos = data.sealedLine ? `Créé le ${data.createdAt} · ${data.sealedLine}` : `Créé le ${data.createdAt}`;
  centerText(page, infos, cx, cursor, fonts.regular, fitSize(infos, fonts.regular, 7, LABEL_W - 6 * MM));
}

function drawQr(page: PDFPage, qr: QrSymbol, x: number, y: number, size: number) {
  const count = qr.modules.size;
  // Un SEUL tracé pour tout le symbole, en unités de module (mis à
  // l'échelle par `scale`), une sous-partie par suite horizontale de modules
  // noirs. Surtout pas un rectangle par module ou par rangée : le lissage des
  // visualiseurs laisse alors un liseré blanc à chaque jointure, assez pour
  // faire échouer jsQR — et qu'une tête thermique imprimerait tel quel.
  let path = "";
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.modules.get(row, col)) col++;
      path += `M${start} ${row}h${col - start}v1h${start - col}z`;
    }
  }
  // drawSvgPath place l'origine SVG (coin haut-gauche, y vers le bas) en (x, y).
  page.drawSvgPath(path, { x, y: y + size, scale: size / count, color: BLACK, borderWidth: 0 });
}

/** Traits de coupe aux quatre coins, à l'extérieur de l'étiquette. */
function drawCutMarks(page: PDFPage, x: number, y: number) {
  const len = 2.5 * MM;
  const off = 1 * MM;
  const color = rgb(0.6, 0.6, 0.6);
  const corners: [number, number, number, number][] = [
    [x, y, -1, -1],
    [x + LABEL_W, y, 1, -1],
    [x, y + LABEL_H, -1, 1],
    [x + LABEL_W, y + LABEL_H, 1, 1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    page.drawLine({ start: { x: cx + dx * off, y: cy }, end: { x: cx + dx * (off + len), y: cy }, thickness: 0.4, color });
    page.drawLine({ start: { x: cx, y: cy + dy * off }, end: { x: cx, y: cy + dy * (off + len) }, thickness: 0.4, color });
  }
}

function centerText(page: PDFPage, text: string, cx: number, y: number, font: PDFFont, size: number) {
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y, size, font, color: BLACK });
}

/** Réduit la police jusqu'à ce que le texte tienne dans la largeur, sans descendre sous 5 pt. */
function fitSize(text: string, font: PDFFont, preferred: number, maxWidth: number) {
  let size = preferred;
  while (size > 5 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}
