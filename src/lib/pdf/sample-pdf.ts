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
const ETIQUETTE_H = 180;
const ETIQUETTE_BOTTOM = 40;
const ETIQUETTE_TOP = ETIQUETTE_BOTTOM + ETIQUETTE_H;
/** Trait de découpe, au-dessus de l'étiquette. */
const CUT_Y = ETIQUETTE_TOP + 24;
/**
 * Cartouche de décision, posé juste au-dessus du trait de découpe : titre +
 * deux cadres. Assez haut pour recevoir la signature et le cachet de la
 * direction (demande Ayman, 06/10), à l'image du devis.
 */
const DECISION_BOX_H = 80;
const DECISION_H = DECISION_BOX_H + 28;
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
const WARN_SOFT = rgb(0.98, 0.94, 0.86);

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
  /**
   * Validations déjà posées dans l'outil (0100) : le cartouche imprime alors
   * le nom et la date au lieu des cases à cocher, pour que le papier dise la
   * même chose que l'écran.
   */
  validations: {
    client: { at: string | null; byName: string | null; onBehalf: boolean };
    direction: { at: string | null; byName: string | null };
  };
  /**
   * Cachet de la société et signature de la personne qui a validé pour la
   * direction (document_signatories / company_stamp, migration 0062 — le
   * même mécanisme que le devis). Null si elle n'a pas de signature
   * enregistrée : le cadre sort alors avec son nom et une ligne à signer.
   */
  directionSeal: { signaturePng: Uint8Array; stampPng: Uint8Array | null; name: string; fonction: string | null } | null;
  /**
   * Dernière réponse négative (0100/0101) : elle a son propre bandeau, avec
   * son motif — le cartouche ne porte que les validations.
   */
  negativeDecision: { label: string; motif: string | null; byName: string | null; at: string } | null;
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

  // Signature et cachet de la direction, embarqués d'avance : une image
  // illisible laisse le cadre avec le nom et une ligne à signer, jamais une
  // génération en échec (même prudence que la maquette).
  let signatureImage: PDFImage | null = null;
  let stampImage: PDFImage | null = null;
  if (data.directionSeal) {
    try {
      signatureImage = await pdfDoc.embedPng(data.directionSeal.signaturePng);
    } catch {
      signatureImage = null;
    }
    if (data.directionSeal.stampPng) {
      try {
        stampImage = await pdfDoc.embedPng(data.directionSeal.stampPng);
      } catch {
        stampImage = null;
      }
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
    // Les NOMS des fichiers vivent ici, dans la grille : la vignette plus bas
    // n'est qu'un aperçu, et peut sauter sur une fiche chargée sans que
    // l'information disparaisse du document.
    { label: "Maquette", value: data.maquette ? data.maquette.fileName : "aucune" },
    {
      label: "Visuel(s) de l'article",
      value:
        data.visuelNames.length > 0
          ? data.visuelNames.join(", ")
          : data.requiresVisuel
            ? "AUCUN — article imprimé, visuel attendu"
            : "aucun",
    },
  ];
  const gutter = 20;
  const colW = (CONTENT_W - gutter) / 2;
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    // Les deux dernières cellules (maquette, visuels) tiennent sur une ligne :
    // un nom de fichier tronqué reste identifiable, et la place gagnée profite
    // au besoin exprimé plus bas.
    const rows = pair.map((cell) => wrapClamped(cell.value, colW, 10, font, i >= 6 ? 1 : 2));
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

  // Une fiche refusée porte en plus le bandeau de motif : le besoin cède une
  // ligne pour lui faire de la place.
  // Hauteur du bandeau de motif, nécessaire dès maintenant : c'est lui, avec
  // le cartouche de signature, qui fixe le plancher auquel le bloc « besoin »
  // doit s'arrêter. Mesuré ici, dessiné plus bas.
  const negativeBandH = data.negativeDecision
    ? 30 + wrapClamped(data.negativeDecision.motif ?? "Aucun motif précisé.", CONTENT_W - 24, 9, font, 2).length * 12 + 14
    : 0;
  const besoinFloor = DECISION_TOP + negativeBandH + 6;
  const besoinGap = data.negativeDecision ? 10 : 16;

  // Le besoin est servi en premier, puis rogné ligne à ligne tant qu'il
  // dépasse ce plancher : les informations complémentaires cèdent d'abord,
  // le besoin lui-même ensuite. Une fiche très remplie imprime donc un
  // besoin tronqué par « ... » plutôt qu'un texte à cheval sur le reste.
  let besoinMaxLines = 4;
  let extraMaxLines = data.extraInfo ? 2 : 0;
  let besoinLines: string[] = [];
  let extraLines: string[] = [];
  let besoinH = 0;
  for (;;) {
    besoinLines = wrapClamped(data.needDescription, CONTENT_W - 24, 10, font, besoinMaxLines);
    extraLines = extraMaxLines > 0 && data.extraInfo ? wrapClamped(data.extraInfo, CONTENT_W - 24, 9, font, extraMaxLines) : [];
    besoinH = 12 + besoinLines.length * 13 + (extraLines.length > 0 ? 8 + extraLines.length * 11 : 0) + 10;
    if (y - besoinH - besoinGap >= besoinFloor) break;
    if (extraMaxLines > 0) extraMaxLines -= 1;
    else if (besoinMaxLines > 1) besoinMaxLines -= 1;
    else break;
  }

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
  y -= besoinH + besoinGap;

  // Aperçu de la maquette — un bonus, pas un porteur d'information : les
  // noms de fichiers sont déjà dans la grille ci-dessus. La place restante
  // est mesurée avant d'écrire quoi que ce soit, le bandeau de motif et le
  // cartouche de signature étant à ordonnée fixe. Sur une fiche chargée,
  // l'aperçu saute ; seule l'alerte « visuel attendu » reste, parce qu'elle
  // engage la production.
  const mediaAvailableH = y - DECISION_TOP - negativeBandH - 12;
  const visuelMissing = data.visuelNames.length === 0 && data.requiresVisuel;

  if (mediaAvailableH >= 92) {
    sectionTitle("Maquette", "déposée sur l'article, reprise sur l'ODF");
    const blockTop = y;
    const blockH = mediaAvailableH - 28;
    const imgBoxW = 150;
    const imgBoxH = Math.min(104, blockH - 14);

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
    }

    const noteX = LEFT + imgBoxW + 20;
    let noteBaseline = blockTop - 10;
    if (visuelMissing) {
      text("AUCUN VISUEL JOINT", { x: noteX, baseline: noteBaseline, size: 9, font: bold, color: WARN });
      noteBaseline -= 12;
      for (const line of wrap("Cet article passe par un atelier qui exige un visuel : l'impression ne peut pas travailler sans fichier.", RIGHT - noteX, 8, font)) {
        text(line, { x: noteX, baseline: noteBaseline, size: 8, color: WARN });
        noteBaseline -= 10;
      }
      noteBaseline -= 4;
    }
    text(`Référence interne ${safe(data.reference)}`, { x: noteX, baseline: noteBaseline, size: 7.5, color: MUTED });
    y = blockTop - blockH;
  } else if (mediaAvailableH >= 46) {
    // Place réduite : aperçu plus petit, sans titre de section — mieux vaut
    // une vignette de 40 points qu'un blanc de 60.
    const blockTop = y;
    const imgBoxH = Math.min(70, mediaAvailableH - 10);
    const imgBoxW = Math.round(imgBoxH * 1.4);
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
      const scale = Math.min((imgBoxW - 8) / maquetteImage.width, (imgBoxH - 8) / maquetteImage.height);
      page.drawImage(maquetteImage, {
        x: LEFT + (imgBoxW - maquetteImage.width * scale) / 2,
        y: blockTop - imgBoxH + (imgBoxH - maquetteImage.height * scale) / 2,
        width: maquetteImage.width * scale,
        height: maquetteImage.height * scale,
      });
    } else {
      text(data.maquette ? "Maquette non affichable" : "Aucune maquette", {
        x: LEFT,
        baseline: blockTop - imgBoxH / 2 - 3,
        size: 7.5,
        color: MUTED,
        width: imgBoxW,
        align: "center",
      });
    }
    const noteX = LEFT + imgBoxW + 16;
    text("MAQUETTE", { x: noteX, baseline: blockTop - 9, size: 7.5, font: bold, color: MUTED });
    if (visuelMissing) {
      text("AUCUN VISUEL JOINT — atelier qui en exige un.", { x: noteX, baseline: blockTop - 23, size: 8.5, font: bold, color: WARN });
    }
    text(`Référence interne ${safe(data.reference)}`, { x: noteX, baseline: blockTop - imgBoxH + 2, size: 7.5, color: MUTED });
    y = blockTop - imgBoxH - 10;
  } else if (visuelMissing && mediaAvailableH >= 14) {
    text("AUCUN VISUEL JOINT — cet article passe par un atelier qui en exige un.", {
      x: LEFT,
      baseline: y - 9,
      size: 8.5,
      font: bold,
      color: WARN,
    });
    y -= 16;
  }

  // Bandeau de réponse négative : « à ajuster » ou « refusé » ne se cochent
  // pas dans le cartouche de signature (demande Ayman, 06/10) — la décision
  // et SON MOTIF ont leur propre bloc, juste au-dessus.
  if (data.negativeDecision) {
    const motifLines = wrapClamped(data.negativeDecision.motif ?? "Aucun motif précisé.", CONTENT_W - 24, 9, font, 2);
    const bandH = negativeBandH - 14;
    const bandTop = DECISION_TOP + 14 + bandH;
    page.drawRectangle({
      x: LEFT,
      y: bandTop - bandH,
      width: CONTENT_W,
      height: bandH,
      color: WARN_SOFT,
      borderColor: WARN,
      borderWidth: 0.7,
    });
    text(data.negativeDecision.label.toUpperCase(), { x: LEFT + 12, baseline: bandTop - 14, size: 9, font: bold, color: WARN });
    text(`${data.negativeDecision.byName ?? "—"} - ${data.negativeDecision.at}`, {
      x: LEFT,
      baseline: bandTop - 14,
      size: 8,
      color: MUTED,
      width: CONTENT_W - 12,
      align: "right",
    });
    let motifBaseline = bandTop - 28;
    for (const line of motifLines) {
      text(line, { x: LEFT + 12, baseline: motifBaseline, size: 9 });
      motifBaseline -= 12;
    }
  }

  // Cartouche de décision : c'est ce papier qui accompagne l'échantillon.
  // Posé à une ordonnée fixe juste au-dessus du trait de découpe, pour que
  // la découpe tombe toujours au même endroit d'une fiche à l'autre. Il ne
  // porte que les VALIDATIONS : côté client un nom, côté direction une
  // signature et un cachet.
  y = DECISION_TOP;
  sectionTitle("Décision sur l'échantillon", "signer ici, ou valider dans Seritex");

  const halfW = (CONTENT_W - gutter) / 2;

  // ---- Côté client : validé par (le client, ou le commercial pour lui) ----
  const clientX = LEFT;
  page.drawRectangle({
    x: clientX,
    y: y - DECISION_BOX_H,
    width: halfW,
    height: DECISION_BOX_H,
    color: WHITE,
    borderColor: RULE,
    borderWidth: 0.5,
  });
  text("CLIENT", { x: clientX + 8, baseline: y - 13, size: 7.5, font: bold, color: BRAND });
  if (data.validations.client.at) {
    text("VALIDÉ PAR", { x: clientX + 8, baseline: y - 30, size: 7.5, font: bold, color: MUTED });
    text(ellipsize(data.validations.client.byName ?? "—", halfW - 16, 11, bold), {
      x: clientX + 8,
      baseline: y - 45,
      size: 11,
      font: bold,
    });
    text(
      `${data.validations.client.at}${data.validations.client.onBehalf ? " - enregistré par le commercial" : " - validé dans Seritex"}`,
      { x: clientX + 8, baseline: y - 58, size: 8, color: MUTED }
    );
  } else {
    hLine(y - 58, clientX + 8, clientX + halfW - 8, 0.5, RULE);
    text("Nom, date et signature", { x: clientX + 8, baseline: y - 68, size: 7, color: MUTED });
  }

  // ---- Côté direction : signature de celui qui valide, sur le cachet ----
  const dirX = LEFT + halfW + gutter;
  page.drawRectangle({
    x: dirX,
    y: y - DECISION_BOX_H,
    width: halfW,
    height: DECISION_BOX_H,
    color: WHITE,
    borderColor: RULE,
    borderWidth: 0.5,
  });
  text("DIRECTION", { x: dirX + 8, baseline: y - 13, size: 7.5, font: bold, color: BRAND });
  if (data.validations.direction.at) {
    // Cachet dessous, signature par-dessus (encre sur tampon), comme sur le
    // devis et comme sur papier.
    if (stampImage) {
      const maxH = 54;
      const maxW = halfW * 0.5;
      const k = Math.min(maxW / stampImage.width, maxH / stampImage.height);
      page.drawImage(stampImage, {
        x: dirX + halfW - stampImage.width * k - 12,
        y: y - DECISION_BOX_H + 20,
        width: stampImage.width * k,
        height: stampImage.height * k,
        opacity: 0.92,
      });
    }
    if (signatureImage) {
      const k = Math.min((halfW * 0.5) / signatureImage.width, 34 / signatureImage.height);
      page.drawImage(signatureImage, {
        x: dirX + 10,
        y: y - DECISION_BOX_H + 26,
        width: signatureImage.width * k,
        height: signatureImage.height * k,
      });
    } else {
      text("VALIDÉ PAR", { x: dirX + 8, baseline: y - 30, size: 7.5, font: bold, color: MUTED });
    }
    const dirName = data.directionSeal?.name ?? data.validations.direction.byName ?? "—";
    text(ellipsize(dirName, halfW - 16, 9.5, bold), { x: dirX + 8, baseline: y - DECISION_BOX_H + 19, size: 9.5, font: bold });
    const dirSub = [data.directionSeal?.fonction, data.validations.direction.at].filter(Boolean).join(" - ");
    text(ellipsize(dirSub, halfW - 16, 7.5, font), { x: dirX + 8, baseline: y - DECISION_BOX_H + 9, size: 7.5, color: MUTED });
  } else {
    hLine(y - 58, dirX + 8, dirX + halfW - 8, 0.5, RULE);
    text("Nom, date, cachet et signature", { x: dirX + 8, baseline: y - 68, size: 7, color: MUTED });
  }

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
