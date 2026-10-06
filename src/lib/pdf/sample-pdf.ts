import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { getLogoPngBytes } from "@/lib/pdf/logo";

/**
 * Bon imprimable de la fiche échantillon, en DEUX parties sur une seule page
 * A4 (demande Ayman, 06/10) :
 *
 *   1. LA FICHE, en haut : tout ce qu'il faut pour fabriquer et faire valider
 *      l'échantillon — client, demande, article concerné, besoin exprimé,
 *      maquette, visuels — et un cartouche de décision à signer (client et
 *      direction), puisque c'est ce papier qui circule avec l'échantillon.
 *   2. L'ÉTIQUETTE, en bas, à découper au trait pointillé et à attacher au
 *      vêtement : numéro d'échantillon en gros, QR code vers la fiche
 *      complète, client et article. Un repère de perforation indique où
 *      passer le fil.
 *
 * La page ne déborde jamais : la zone de l'étiquette est réservée d'avance
 * (ETIQUETTE_TOP), et les blocs variables de la fiche (besoin, informations
 * complémentaires, maquette) sont bornés en nombre de lignes et en hauteur.
 * Une fiche imprimée tient sur une feuille, toujours.
 */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const M = 42;
const LEFT = M;
const RIGHT = PAGE_W - M;
const CONTENT_W = RIGHT - LEFT;

/** Hauteur réservée en bas de page à l'étiquette détachable. */
const ETIQUETTE_H = 186;
const ETIQUETTE_BOTTOM = 56;
const ETIQUETTE_TOP = ETIQUETTE_BOTTOM + ETIQUETTE_H;
/** Trait de découpe, au-dessus de l'étiquette. */
const CUT_Y = ETIQUETTE_TOP + 30;
/** Cartouche de décision, posé juste au-dessus du trait de découpe : titre + deux cadres. */
const DECISION_H = 86;
const DECISION_TOP = CUT_Y + DECISION_H + 14;

// Même palette que l'ordre de fabrication (odf-pdf.ts) : les deux documents
// sortent de la même imprimante, ils doivent se ressembler.
const BRAND = rgb(0, 0.251, 0.565);
const BRAND_SOFT = rgb(0.89, 0.918, 0.965);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.11, 0.09, 0.09);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.85, 0.83, 0.8);
const HAIRLINE = rgb(0.91, 0.9, 0.88);
const BOX_FILL = rgb(0.98, 0.977, 0.972);
const WARN = rgb(0.71, 0.47, 0.1);

export interface SamplePdfData {
  /** Numéro lisible encodé dans le QR (ECH-2026-00012) — la vedette de l'étiquette. */
  sampleNumber: string;
  reference: string;
  statusLabel: string;
  priorityLabel: string;
  companyName: string | null;
  requestReference: string | null;
  /** « DEV-2026-0311 - T-shirt col rond 180g » : l'article du devis concerné. */
  quoteLineLabel: string | null;
  /** « ODF-2026-0148 - T-shirt col rond 180g (En production) ». */
  orderLineLabel: string | null;
  needDescription: string;
  extraInfo: string | null;
  requestDate: string;
  dueDate: string | null;
  visuelNames: string[];
  /** Article qui passe par un atelier exigeant un visuel : l'absence est signalée. */
  requiresVisuel: boolean;
  maquette: { bytes: Buffer; format: "png" | "jpg"; fileName: string } | null;
  sheetUrl: string;
  generatedAt: string;
}

/**
 * Les polices standard PDF sont encodées en WinAnsi : un caractère hors de
 * ce jeu fait échouer `drawText`. Tout ce qui vient de la base passe par
 * ici (même fonction que odf-pdf.ts).
 */
function safe(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[^ -ÿ\n]/g, "?");
}

export async function buildSamplePdf(data: SamplePdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Fiche échantillon ${safe(data.sampleNumber)}`);
  pdfDoc.setProducer("Seritex");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdfDoc.embedPng(await getLogoPngBytes());
  const logoRatio = logo.width / logo.height;
  const qrPng = await QRCode.toBuffer(data.sheetUrl, { type: "png", width: 320, margin: 0 });
  const qr = await pdfDoc.embedPng(qrPng);

  // Maquette embarquée d'avance : un fichier illisible par pdf-lib (PDF, AI,
  // SVG, ou PNG corrompu) laisse simplement la fiche sans image, jamais une
  // génération en échec.
  let maquetteImage: PDFImage | null = null;
  if (data.maquette) {
    try {
      maquetteImage =
        data.maquette.format === "png"
          ? await pdfDoc.embedPng(data.maquette.bytes)
          : await pdfDoc.embedJpg(data.maquette.bytes);
    } catch {
      maquetteImage = null;
    }
  }

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 36;

  const w = (value: string, size: number, f: PDFFont) => f.widthOfTextAtSize(safe(value), size);

  function wrap(value: string, maxWidth: number, size: number, f: PDFFont): string[] {
    const words = safe(value).trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (w(attempt, size, f) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function ellipsize(value: string, maxWidth: number, size: number, f: PDFFont): string {
    const content = safe(value);
    if (w(content, size, f) <= maxWidth) return content;
    let cut = content;
    while (cut.length > 1 && w(`${cut}...`, size, f) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  /** Coupe un texte à `maxLines` lignes, la dernière suffixée par « ... ». */
  function wrapClamped(value: string, maxWidth: number, size: number, f: PDFFont, maxLines: number): string[] {
    const lines = wrap(value, maxWidth, size, f);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines[maxLines].split(" ")[0]}`, maxWidth, size, f);
    return kept;
  }

  function text(
    value: string,
    opts: {
      x: number;
      baseline: number;
      size: number;
      font?: PDFFont;
      color?: RGB;
      width?: number;
      align?: "left" | "right" | "center";
    }
  ) {
    const f = opts.font ?? font;
    const content = safe(value);
    let x = opts.x;
    if (opts.width !== undefined && opts.align === "right") x = opts.x + opts.width - w(content, opts.size, f);
    if (opts.width !== undefined && opts.align === "center") x = opts.x + (opts.width - w(content, opts.size, f)) / 2;
    page.drawText(content, { x, y: opts.baseline, size: opts.size, font: f, color: opts.color ?? INK });
  }

  function hLine(atY: number, from = LEFT, to = RIGHT, thickness = 0.5, color = HAIRLINE) {
    page.drawLine({ start: { x: from, y: atY }, end: { x: to, y: atY }, thickness, color });
  }

  function sectionTitle(title: string, hint?: string) {
    text(title.toUpperCase(), { x: LEFT, baseline: y - 10, size: 9.5, font: bold, color: BRAND });
    if (hint) text(hint, { x: LEFT, baseline: y - 9.5, size: 7.5, color: MUTED, width: CONTENT_W, align: "right" });
    hLine(y - 15, LEFT, RIGHT, 0.9, BRAND);
    y -= 28;
  }

  // -------------------------------------------------------------------------
  // PARTIE 1 — LA FICHE
  // -------------------------------------------------------------------------

  const logoH = 24;
  page.drawImage(logo, { x: LEFT, y: y - logoH, width: logoH * logoRatio, height: logoH });
  text("Fiche échantillon", { x: LEFT, baseline: y - logoH - 12, size: 11, color: MUTED });

  // Numéro d'échantillon : c'est l'identifiant que tout le monde cite.
  text(data.sampleNumber, { x: LEFT, baseline: y - 14, size: 17, font: bold, width: CONTENT_W, align: "right" });
  const statusLabel = safe(data.statusLabel).toUpperCase();
  const badgeW = w(statusLabel, 8, bold) + 18;
  page.drawRectangle({ x: RIGHT - badgeW, y: y - 36, width: badgeW, height: 15, color: BRAND });
  text(statusLabel, { x: RIGHT - badgeW, baseline: y - 31.5, size: 8, font: bold, color: WHITE, width: badgeW, align: "center" });
  text(`Priorité ${safe(data.priorityLabel).toLowerCase()}`, {
    x: LEFT,
    baseline: y - 48,
    size: 8,
    color: MUTED,
    width: CONTENT_W,
    align: "right",
  });

  hLine(y - 58, LEFT, RIGHT, 1.2, BRAND);
  y -= 78;

  // Identité de l'échantillon : deux colonnes de couples étiquette/valeur.
  type Cell = { label: string; value: string };
  const cells: Cell[] = [
    { label: "Client", value: data.companyName ?? "Demande interne (stock)" },
    { label: "Demande", value: data.requestReference ?? "à rattacher" },
    { label: "Article du devis", value: data.quoteLineLabel ?? "aucun" },
    { label: "Article d'ordre de fabrication", value: data.orderLineLabel ?? "aucun" },
    { label: "Date de la demande", value: data.requestDate },
    { label: "Délai souhaité", value: data.dueDate ?? "—" },
  ];
  const gutter = 20;
  const colW = (CONTENT_W - gutter) / 2;
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    const rows = pair.map((cell) => wrapClamped(cell.value, colW, 10, font, 2));
    const rowH = 13 + Math.max(...rows.map((lines) => lines.length)) * 13 + 6;
    const top = y;
    pair.forEach((cell, col) => {
      const x = LEFT + col * (colW + gutter);
      text(cell.label.toUpperCase(), { x, baseline: top - 8, size: 7.5, font: bold, color: MUTED });
      let baseline = top - 21;
      for (const line of rows[col]) {
        text(line, { x, baseline, size: 10 });
        baseline -= 13;
      }
    });
    y = top - rowH;
    if (i + 2 < cells.length) {
      hLine(y + 2, LEFT, RIGHT, 0.5, RULE);
      y -= 6;
    }
  }

  y -= 6;
  sectionTitle("Besoin exprimé", "ce que l'échantillon doit démontrer");

  const besoinLines = wrapClamped(data.needDescription, CONTENT_W - 24, 10, font, 4);
  const extraLines = data.extraInfo ? wrapClamped(data.extraInfo, CONTENT_W - 24, 9, font, 2) : [];
  const besoinH = 12 + besoinLines.length * 13 + (extraLines.length > 0 ? 8 + extraLines.length * 11 : 0) + 10;
  page.drawRectangle({
    x: LEFT,
    y: y - besoinH,
    width: CONTENT_W,
    height: besoinH,
    color: BOX_FILL,
    borderColor: HAIRLINE,
    borderWidth: 0.5,
  });
  let besoinBaseline = y - 22;
  for (const line of besoinLines) {
    text(line, { x: LEFT + 12, baseline: besoinBaseline, size: 10 });
    besoinBaseline -= 13;
  }
  if (extraLines.length > 0) {
    besoinBaseline -= 4;
    text("Informations complémentaires", { x: LEFT + 12, baseline: besoinBaseline, size: 7.5, font: bold, color: MUTED });
    besoinBaseline -= 11;
    for (const line of extraLines) {
      text(line, { x: LEFT + 12, baseline: besoinBaseline, size: 9, color: MUTED });
      besoinBaseline -= 11;
    }
  }
  y -= besoinH + 16;

  // Maquette à gauche, visuels à droite : les deux fichiers que l'atelier
  // doit avoir sous les yeux (0094).
  sectionTitle("Maquette et visuels", "déposés sur l'article, repris sur l'ODF");

  const blockTop = y;
  const imgBoxW = 150;
  // -28 : la légende du fichier passe sous la vignette, elle ne doit pas
  // venir toucher le titre du cartouche de décision.
  const imgBoxH = Math.max(40, Math.min(104, blockTop - DECISION_TOP - 28));
  page.drawRectangle({
    x: LEFT,
    y: blockTop - imgBoxH,
    width: imgBoxW,
    height: imgBoxH,
    color: WHITE,
    borderColor: HAIRLINE,
    borderWidth: 0.5,
  });
  if (maquetteImage) {
    const scale = Math.min((imgBoxW - 12) / maquetteImage.width, (imgBoxH - 12) / maquetteImage.height);
    const drawW = maquetteImage.width * scale;
    const drawH = maquetteImage.height * scale;
    page.drawImage(maquetteImage, {
      x: LEFT + (imgBoxW - drawW) / 2,
      y: blockTop - imgBoxH + (imgBoxH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  } else {
    const message = data.maquette ? "Maquette non affichable" : "Aucune maquette";
    text(message, { x: LEFT, baseline: blockTop - imgBoxH / 2 - 3, size: 8.5, color: MUTED, width: imgBoxW, align: "center" });
    if (data.maquette) {
      text(ellipsize(data.maquette.fileName, imgBoxW - 12, 7, font), {
        x: LEFT,
        baseline: blockTop - imgBoxH / 2 - 15,
        size: 7,
        color: MUTED,
        width: imgBoxW,
        align: "center",
      });
    }
  }
  if (data.maquette && maquetteImage) {
    text(ellipsize(data.maquette.fileName, imgBoxW, 7, font), {
      x: LEFT,
      baseline: blockTop - imgBoxH - 9,
      size: 7,
      color: MUTED,
      width: imgBoxW,
      align: "center",
    });
  }

  const visuelX = LEFT + imgBoxW + 20;
  const visuelW = RIGHT - visuelX;
  text("VISUEL(S) DE L'ARTICLE", { x: visuelX, baseline: blockTop - 8, size: 7.5, font: bold, color: MUTED });
  let visuelBaseline = blockTop - 22;
  if (data.visuelNames.length > 0) {
    for (const name of data.visuelNames.slice(0, 4)) {
      text(`- ${ellipsize(name, visuelW - 10, 9, font)}`, { x: visuelX, baseline: visuelBaseline, size: 9 });
      visuelBaseline -= 12;
    }
    if (data.visuelNames.length > 4) {
      text(`+ ${data.visuelNames.length - 4} autre(s)`, { x: visuelX, baseline: visuelBaseline, size: 8, color: MUTED });
      visuelBaseline -= 12;
    }
  } else if (data.requiresVisuel) {
    text("AUCUN — article imprimé, visuel attendu", { x: visuelX, baseline: visuelBaseline, size: 9, font: bold, color: WARN });
    visuelBaseline -= 12;
  } else {
    text("aucun", { x: visuelX, baseline: visuelBaseline, size: 9, color: MUTED });
    visuelBaseline -= 12;
  }
  text(`Référence interne ${safe(data.reference)}`, { x: visuelX, baseline: visuelBaseline - 4, size: 7.5, color: MUTED });

  y = blockTop - imgBoxH - 24;

  // Cartouche de décision : c'est ce papier qui accompagne l'échantillon,
  // la validation s'y écrit à la main avant d'être reportée dans l'outil.
  // Posé à une ordonnée fixe juste au-dessus du trait de découpe, pour que
  // la découpe tombe toujours au même endroit d'une fiche à l'autre.
  y = DECISION_TOP;
  sectionTitle("Décision sur l'échantillon", "à reporter ensuite dans Seritex");

  const halfW = (CONTENT_W - gutter) / 2;
  const decisionBoxH = 52;
  (["Client", "Direction"] as const).forEach((who, col) => {
    const x = LEFT + col * (halfW + gutter);
    page.drawRectangle({
      x,
      y: y - decisionBoxH,
      width: halfW,
      height: decisionBoxH,
      color: WHITE,
      borderColor: RULE,
      borderWidth: 0.5,
    });
    text(who.toUpperCase(), { x: x + 8, baseline: y - 13, size: 7.5, font: bold, color: BRAND });
    let boxX = x + 8;
    for (const choice of ["Validé", "À ajuster", "Refusé"]) {
      page.drawRectangle({ x: boxX, y: y - 28, width: 8, height: 8, borderColor: INK, borderWidth: 0.7 });
      text(choice, { x: boxX + 11, baseline: y - 27, size: 8 });
      boxX += 11 + w(choice, 8, font) + 10;
    }
    hLine(y - 42, x + 8, x + halfW - 8, 0.5, RULE);
    text("Nom, date et signature", { x: x + 8, baseline: y - 50, size: 7, color: MUTED });
  });

  // -------------------------------------------------------------------------
  // PARTIE 2 — L'ÉTIQUETTE À DÉTACHER
  // -------------------------------------------------------------------------

  // Trait de découpe, interrompu au centre par son libellé.
  const cutLabel = "DÉCOUPER ICI";
  const cutLabelW = w(cutLabel, 7.5, bold) + 16;
  const cutGapStart = LEFT + (CONTENT_W - cutLabelW) / 2;
  for (const [from, to] of [
    [LEFT, cutGapStart],
    [cutGapStart + cutLabelW, RIGHT],
  ] as const) {
    page.drawLine({
      start: { x: from, y: CUT_Y },
      end: { x: to, y: CUT_Y },
      thickness: 0.8,
      color: MUTED,
      dashArray: [4, 3],
    });
  }
  text(cutLabel, { x: cutGapStart, baseline: CUT_Y - 2.5, size: 7.5, font: bold, color: MUTED, width: cutLabelW, align: "center" });

  // L'étiquette elle-même : cadre franc, numéro en gros, QR à droite.
  const tagW = 322;
  const tagX = LEFT;
  const tagY = ETIQUETTE_BOTTOM;
  page.drawRectangle({ x: tagX, y: tagY, width: tagW, height: ETIQUETTE_H, borderColor: INK, borderWidth: 1, color: WHITE });
  page.drawRectangle({ x: tagX, y: tagY + ETIQUETTE_H - 22, width: tagW, height: 22, color: BRAND_SOFT });
  text("ÉCHANTILLON — NE PAS JETER", { x: tagX + 12, baseline: tagY + ETIQUETTE_H - 15, size: 8, font: bold, color: BRAND });

  // Repère de perforation : c'est par là que passe le fil sur le vêtement.
  const holeX = tagX + tagW - 22;
  const holeY = tagY + ETIQUETTE_H - 11;
  page.drawEllipse({ x: holeX, y: holeY, xScale: 4.5, yScale: 4.5, borderColor: BRAND, borderWidth: 0.8, color: WHITE });

  const tagQrSize = 92;
  const tagQrX = tagX + tagW - tagQrSize - 14;
  // Centré dans la hauteur utile (sous le bandeau), légende comprise.
  const tagQrY = tagY + (ETIQUETTE_H - 22 - tagQrSize) / 2 + 6;
  page.drawImage(qr, { x: tagQrX, y: tagQrY, width: tagQrSize, height: tagQrSize });
  text("Scanner pour la fiche", { x: tagQrX, baseline: tagQrY - 11, size: 6.5, color: MUTED, width: tagQrSize, align: "center" });

  const tagTextW = tagQrX - tagX - 26;
  text(data.sampleNumber, { x: tagX + 12, baseline: tagY + ETIQUETTE_H - 54, size: 19, font: bold });
  let tagBaseline = tagY + ETIQUETTE_H - 78;
  text(ellipsize(data.companyName ?? "Demande interne (stock)", tagTextW, 10, bold), {
    x: tagX + 12,
    baseline: tagBaseline,
    size: 10,
    font: bold,
  });
  tagBaseline -= 16;
  for (const line of wrapClamped(data.quoteLineLabel ?? data.orderLineLabel ?? data.needDescription, tagTextW, 9, font, 3)) {
    text(line, { x: tagX + 12, baseline: tagBaseline, size: 9 });
    tagBaseline -= 12;
  }
  tagBaseline -= 8;
  text(`Demande ${safe(data.requestReference ?? "—")} · ${safe(data.requestDate)}`, {
    x: tagX + 12,
    baseline: tagBaseline,
    size: 7.5,
    color: MUTED,
  });

  // Mode d'emploi, à droite de l'étiquette (reste sur la souche).
  const noteX = tagX + tagW + 22;
  const noteW = RIGHT - noteX;
  text("À DÉTACHER", { x: noteX, baseline: tagY + ETIQUETTE_H - 15, size: 8, font: bold, color: BRAND });
  let noteBaseline = tagY + ETIQUETTE_H - 33;
  for (const note of [
    "Découper au trait pointillé.",
    "Perforer au repère rond.",
    "Attacher l'étiquette à l'échantillon.",
    "La laisser en place jusqu'à la décision.",
  ]) {
    for (const line of wrap(note, noteW - 10, 8, font)) {
      text(`- ${line}`, { x: noteX, baseline: noteBaseline, size: 8, color: INK });
      noteBaseline -= 11;
    }
    noteBaseline -= 2;
  }
  text(`Statut à l'impression : ${safe(data.statusLabel)}`, { x: noteX, baseline: noteBaseline - 4, size: 7.5, color: MUTED });

  // Pied de page.
  text(`Document généré le ${safe(data.generatedAt)} — ${safe(data.sheetUrl)}`, {
    x: LEFT,
    baseline: 28,
    size: 6.5,
    color: MUTED,
  });

  return pdfDoc.save();
}
