import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";

/**
 * Mise en page du bon imprimable de l'ordre de fabrication.
 *
 * Volontairement séparé de la route HTTP (`api/production/[id]/pdf`) : la
 * route interroge Supabase et aplatit le résultat dans `OdfPdfData`, ce
 * module ne fait que dessiner. C'est ce qui permet de régénérer le
 * document avec des données d'exemple (`scripts/preview-pdf-odf.ts`) pour
 * contrôler la mise en page sans base de données derrière.
 *
 * Principe de la refonte (demande Ayman, 16/09) : c'est un document de
 * travail d'atelier, pas une note rédigée. Donc des blocs cadrés, des
 * tableaux à filets, une étiquette courte au-dessus de chaque valeur — et
 * surtout une géométrie calculée avant de dessiner, pour que plus rien ne
 * se chevauche (l'ancienne version traçait le filet d'en-tête au travers
 * du QR code, et reposait la référence par-dessus le cadre client).
 *
 * Structure de la page :
 *   1. Bandeau       SERITEX + « Ordre de fabrication » à gauche,
 *                    numéro d'ODF + statut à droite.
 *   2. Cadre         Client / Commande sur deux colonnes, QR code de la
 *                    fiche ODF collé à droite DANS le cadre.
 *   3. Articles      un bandeau par article + grille de caractéristiques
 *                    + tableau du dispatching des tailles.
 *   4. Sous-ODF      tableau (section, référence, prévu/fait/reste) avec
 *                    un QR par ligne pour la saisie au terminal.
 *   5. Traçabilité   tableau des événements du cycle de vie.
 */

export type OdfPdfArticle = {
  description: string;
  quantity: number;
  modele: string | null;
  tissu: string | null;
  composition: string | null;
  grammageLaize: string | null;
  /** « Couleur » ou « Couleurs par zone » selon la configuration de la ligne. */
  couleurLabel: string;
  couleur: string | null;
  sections: string | null;
  fiche: string | null;
  visuels: string | null;
  sizes: { taille: string; quantite: number }[];
};

export type OdfPdfSousOdf = {
  reference: string;
  section: string;
  planned: number;
  done: number;
  /** Cible du QR code : le détail de CE sous-ODF. */
  url: string;
};

export type OdfPdfData = {
  reference: string;
  statusLabel: string;
  sheetUrl: string;
  generatedAt: string;
  client: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    siret: string | null;
  } | null;
  devis: string | null;
  totalQuantity: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  articles: OdfPdfArticle[];
  sousOdf: OdfPdfSousOdf[];
  surplusTraces: [string, number][];
  lifecycle: { event: string; date: string; by: string }[];
  clotureNote: string | null;
};

// Géométrie — A4 portrait, en points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M_TOP = 42;
const M_BOTTOM = 44;
const M_SIDE = 42;
const CONTENT_W = PAGE_W - M_SIDE * 2;
const LEFT = M_SIDE;
const RIGHT = PAGE_W - M_SIDE;

// Rythme vertical — une seule source de vérité pour mesurer ET dessiner.
const LABEL_SIZE = 7;
const LABEL_LH = 10;
const VALUE_SIZE = 9.5;
const VALUE_LH = 12;
const CELL_PAD_BOTTOM = 7;

const BRAND = rgb(0.059, 0.298, 0.361); // #0f4c5c
const BRAND_SOFT = rgb(0.906, 0.937, 0.945); // #e7eff1
const INK = rgb(0.11, 0.09, 0.09);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.85, 0.83, 0.8);
const HAIRLINE = rgb(0.91, 0.9, 0.88);
const BOX_FILL = rgb(0.98, 0.977, 0.972);
const ZEBRA = rgb(0.965, 0.96, 0.953);

/**
 * Les polices standard PDF sont encodées en WinAnsi : un caractère hors de
 * ce jeu (emoji collé dans une désignation, guillemet typographique
 * exotique…) fait échouer `drawText`. On normalise donc tout ce qui vient
 * de la base avant de le mesurer ou de le dessiner.
 */
function safe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[^ -ÿ\n]/g, "?");
}

export async function buildOdfPdf(data: OdfPdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Ordre de fabrication ${safe(data.reference)}`);
  pdfDoc.setProducer("Seritex");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Tous les QR sont embarqués d'avance : le dessin qui suit est
  // entièrement synchrone, donc lisible de haut en bas.
  const sheetQr = await embedQr(pdfDoc, data.sheetUrl, 300);
  const sousOdfQr = new Map<string, PDFImage>();
  for (const wo of data.sousOdf) {
    sousOdfQr.set(wo.reference, await embedQr(pdfDoc, wo.url, 180));
  }

  let page: PDFPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = 0;
  /**
   * Bandeau à re-dessiner en haut de page quand un bloc déborde (un article
   * coupé en deux, un tableau qui continue) — remis à null dès que le bloc
   * est terminé.
   */
  let continuation: (() => void) | null = null;

  const w = (value: string, size: number, f: PDFFont) => f.widthOfTextAtSize(safe(value), size);

  function wrap(value: string, maxWidth: number, size: number, f: PDFFont): string[] {
    const source = safe(value).trim();
    if (!source) return ["-"];
    const out: string[] = [];
    for (const paragraph of source.split("\n")) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let current = "";
      for (const word of words) {
        const attempt = current ? `${current} ${word}` : word;
        if (w(attempt, size, f) <= maxWidth) {
          current = attempt;
          continue;
        }
        if (current) {
          out.push(current);
          current = word;
        }
        // Mot plus large que la colonne (référence, URL) : coupe au caractère.
        if (w(current, size, f) > maxWidth) {
          let chunk = "";
          for (const char of current) {
            if (chunk && w(chunk + char, size, f) > maxWidth) {
              out.push(chunk);
              chunk = char;
            } else {
              chunk += char;
            }
          }
          current = chunk;
        }
      }
      if (current) out.push(current);
    }
    return out.length > 0 ? out : ["-"];
  }

  function ellipsize(value: string, maxWidth: number, size: number, f: PDFFont): string {
    const source = safe(value);
    if (w(source, size, f) <= maxWidth) return source;
    let cut = source;
    while (cut.length > 1 && w(`${cut}...`, size, f) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
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

  /** En-tête de première page : identité à gauche, ODF + statut à droite. */
  function drawMainHeader() {
    const top = PAGE_H - M_TOP;
    text("SERITEX", { x: LEFT, baseline: top - 20, size: 21, font: bold, color: BRAND });
    text("Ordre de fabrication", { x: LEFT, baseline: top - 36, size: 11.5, color: MUTED });

    text(data.reference, { x: LEFT, baseline: top - 18, size: 16, font: bold, color: INK, width: CONTENT_W, align: "right" });

    // Pastille de statut : rectangle plein + libellé blanc, calé à droite
    // sous le numéro. Le filet est tracé sous le plus bas des deux blocs,
    // donc aucun recouvrement possible.
    const statusLabel = safe(data.statusLabel).toUpperCase();
    const badgeW = w(statusLabel, 8, bold) + 18;
    const badgeH = 15;
    const badgeY = top - 40;
    page.drawRectangle({ x: RIGHT - badgeW, y: badgeY, width: badgeW, height: badgeH, color: BRAND });
    text(statusLabel, {
      x: RIGHT - badgeW,
      baseline: badgeY + 4.5,
      size: 8,
      font: bold,
      color: rgb(1, 1, 1),
      width: badgeW,
      align: "center",
    });

    const ruleY = top - 50;
    hLine(ruleY, LEFT, RIGHT, 1.2, BRAND);
    y = ruleY - 22;
  }

  /** En-tête allégé des pages suivantes. */
  function drawContinuationHeader() {
    const top = PAGE_H - M_TOP;
    text("SERITEX", { x: LEFT, baseline: top - 10, size: 10, font: bold, color: BRAND });
    text(`Ordre de fabrication ${data.reference}`, {
      x: LEFT,
      baseline: top - 10,
      size: 9,
      color: MUTED,
      width: CONTENT_W,
      align: "right",
    });
    hLine(top - 17, LEFT, RIGHT, 0.75, RULE);
    y = top - 36;
  }

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    drawContinuationHeader();
    if (continuation) continuation();
  }

  /** Garantit `needed` points disponibles au-dessus du pied de page. */
  function ensure(needed: number) {
    if (y - needed < M_BOTTOM + 16) newPage();
  }

  function sectionTitle(title: string, hint?: string) {
    ensure(52);
    text(title.toUpperCase(), { x: LEFT, baseline: y - 10, size: 10.5, font: bold, color: BRAND });
    if (hint) {
      text(hint, { x: LEFT, baseline: y - 9.5, size: 7.5, color: MUTED, width: CONTENT_W, align: "right" });
    }
    hLine(y - 16, LEFT, RIGHT, 0.9, BRAND);
    y -= 30;
  }

  // ---------------------------------------------------------------------
  // Cellule « étiquette au-dessus de la valeur », brique de toutes les
  // grilles du document : mesurée d'abord (cellHeight), dessinée ensuite.
  // ---------------------------------------------------------------------
  type Cell = { label: string; value: string };

  function cellHeight(cell: Cell, width: number): number {
    return LABEL_LH + wrap(cell.value, width, VALUE_SIZE, font).length * VALUE_LH + CELL_PAD_BOTTOM;
  }

  function drawCell(cell: Cell, x: number, top: number, width: number) {
    text(cell.label.toUpperCase(), { x, baseline: top - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
    let baseline = top - LABEL_LH - VALUE_SIZE;
    for (const line of wrap(cell.value, width, VALUE_SIZE, font)) {
      text(line, { x, baseline, size: VALUE_SIZE });
      baseline -= VALUE_LH;
    }
  }

  /**
   * Grille de cellules sur deux colonnes, avec filets de séparation.
   * Chaque ligne est mesurée sur la plus haute de ses deux cellules et
   * `ensure` est appelé ligne par ligne : une grille peut donc traverser
   * une coupure de page sans jamais écrire par-dessus autre chose.
   */
  function drawCellGrid(cells: Cell[], opts: { x: number; width: number; separators?: boolean }) {
    const gutter = 18;
    const colW = (opts.width - gutter) / 2;
    const colX = [opts.x, opts.x + colW + gutter];
    for (let i = 0; i < cells.length; i += 2) {
      const pair = cells.slice(i, i + 2);
      const rowH = Math.max(...pair.map((cell) => cellHeight(cell, colW)));
      ensure(rowH + 4);
      const top = y;
      pair.forEach((cell, col) => drawCell(cell, colX[col], top, colW));
      y = top - rowH;
      if (opts.separators && i + 2 < cells.length) {
        hLine(y + 2, opts.x, opts.x + opts.width, 0.5, RULE);
        y -= 6;
      }
    }
  }

  /**
   * Dispatching des tailles : un vrai tableau à filets (une colonne par
   * taille, une ligne « demandé », une colonne « total »), scindé en
   * plusieurs blocs si les tailles ne tiennent pas sur une largeur.
   */
  function drawSizeTable(sizes: { taille: string; quantite: number }[]) {
    const x = LEFT + 10;
    const width = CONTENT_W - 20;
    ensure(48);
    text("DISPATCHING DES TAILLES", { x, baseline: y - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
    y -= LABEL_LH + 4;

    if (sizes.length === 0) {
      ensure(20);
      text("non renseigné", { x, baseline: y - VALUE_SIZE, size: VALUE_SIZE, color: MUTED });
      y -= VALUE_LH + 4;
      return;
    }

    const headW = 62;
    const minCol = 34;
    const perChunk = Math.max(1, Math.floor((width - headW) / minCol) - 1);
    const rowH = 16;

    for (let start = 0; start < sizes.length; start += perChunk) {
      const chunk = sizes.slice(start, start + perChunk);
      const isLast = start + perChunk >= sizes.length;
      const totalCol = isLast ? 1 : 0;
      const colW = Math.min(60, (width - headW) / (chunk.length + totalCol));
      const tableW = headW + colW * (chunk.length + totalCol);

      ensure(rowH * 2 + 8);
      const top = y;

      page.drawRectangle({ x, y: top - rowH, width: tableW, height: rowH, color: BRAND_SOFT });
      text("TAILLE", { x: x + 6, baseline: top - 11, size: 7, font: bold, color: BRAND });
      text("DEMANDÉ", { x: x + 6, baseline: top - rowH - 11, size: 7, font: bold, color: MUTED });

      chunk.forEach((size, i) => {
        const cx = x + headW + colW * i;
        text(ellipsize(size.taille, colW - 6, 8.5, bold), {
          x: cx,
          baseline: top - 11,
          size: 8.5,
          font: bold,
          width: colW,
          align: "center",
        });
        text(String(size.quantite), { x: cx, baseline: top - rowH - 11, size: 9.5, width: colW, align: "center" });
      });

      if (totalCol) {
        const cx = x + headW + colW * chunk.length;
        const total = sizes.reduce((sum, size) => sum + size.quantite, 0);
        page.drawRectangle({ x: cx, y: top - rowH * 2, width: colW, height: rowH, color: ZEBRA });
        text("TOTAL", { x: cx, baseline: top - 11, size: 7, font: bold, color: BRAND, width: colW, align: "center" });
        text(String(total), { x: cx, baseline: top - rowH - 11, size: 9.5, font: bold, width: colW, align: "center" });
      }

      // Filets : contour, séparation des deux lignes, colonnes.
      page.drawRectangle({ x, y: top - rowH * 2, width: tableW, height: rowH * 2, borderColor: RULE, borderWidth: 0.6 });
      hLine(top - rowH, x, x + tableW, 0.6, RULE);
      for (let i = 0; i <= chunk.length + totalCol; i += 1) {
        const cx = x + headW + colW * i;
        if (cx > x + tableW + 0.1) break;
        page.drawLine({ start: { x: cx, y: top }, end: { x: cx, y: top - rowH * 2 }, thickness: 0.5, color: RULE });
      }

      y = top - rowH * 2 - (isLast ? 0 : 6);
    }
  }

  // ---------------------------------------------------------------------
  // 1. Bandeau
  // ---------------------------------------------------------------------
  drawMainHeader();

  // ---------------------------------------------------------------------
  // 2. Cadre client / commande, QR de la fiche ODF à droite DANS le cadre
  // ---------------------------------------------------------------------
  {
    const pad = 14;
    const qrSize = 84;
    const qrColW = qrSize + 12;
    const fieldsW = CONTENT_W - pad * 2 - qrColW;
    const gutter = 18;
    const colW = (fieldsW - gutter) / 2;

    const clientCells: Cell[] = [
      { label: "Client", value: data.client?.name ?? "-" },
      { label: "Adresse", value: data.client?.address ?? "-" },
      { label: "Téléphone", value: data.client?.phone ?? "-" },
      { label: "E-mail", value: data.client?.email ?? "-" },
      { label: "SIRET", value: data.client?.siret ?? "-" },
    ];
    const orderCells: Cell[] = [
      { label: "Devis d'origine", value: data.devis ?? "-" },
      { label: "Quantité totale", value: `${data.totalQuantity} pièces` },
      { label: "Nombre d'articles", value: `${data.articles.length}` },
      { label: "Planning prévu", value: `${data.plannedStart ?? "-"}  au  ${data.plannedEnd ?? "-"}` },
    ];

    const clientH = clientCells.reduce((sum, cell) => sum + cellHeight(cell, colW), 0);
    const orderH = orderCells.reduce((sum, cell) => sum + cellHeight(cell, colW), 0);
    const qrH = qrSize + 16;
    const boxH = Math.max(clientH - CELL_PAD_BOTTOM, orderH - CELL_PAD_BOTTOM, qrH) + pad * 2;

    ensure(boxH + 12);
    const boxTop = y;
    page.drawRectangle({
      x: LEFT,
      y: boxTop - boxH,
      width: CONTENT_W,
      height: boxH,
      color: BOX_FILL,
      borderColor: RULE,
      borderWidth: 0.9,
    });

    let cursor = boxTop - pad;
    for (const cell of clientCells) {
      drawCell(cell, LEFT + pad, cursor, colW);
      cursor -= cellHeight(cell, colW);
    }
    cursor = boxTop - pad;
    for (const cell of orderCells) {
      drawCell(cell, LEFT + pad + colW + gutter, cursor, colW);
      cursor -= cellHeight(cell, colW);
    }

    // Filet vertical entre les deux colonnes de champs.
    const sepX = LEFT + pad + colW + gutter / 2;
    page.drawLine({
      start: { x: sepX, y: boxTop - pad + 2 },
      end: { x: sepX, y: boxTop - boxH + pad - 2 },
      thickness: 0.5,
      color: HAIRLINE,
    });

    // QR de la fiche ODF, calé sur le bord droit intérieur du cadre.
    const qrX = RIGHT - pad - qrSize;
    page.drawImage(sheetQr, { x: qrX, y: boxTop - pad - qrSize, width: qrSize, height: qrSize });
    text("FICHE ODF EN LIGNE", {
      x: qrX,
      baseline: boxTop - pad - qrSize - 10,
      size: 6.5,
      font: bold,
      color: MUTED,
      width: qrSize,
      align: "center",
    });

    y = boxTop - boxH - 24;
  }

  // ---------------------------------------------------------------------
  // 3. Articles
  // ---------------------------------------------------------------------
  sectionTitle(`Articles à produire (${data.articles.length})`);

  if (data.articles.length === 0) {
    text("Aucun article configuré sur cet ordre de fabrication.", {
      x: LEFT,
      baseline: y - 10,
      size: VALUE_SIZE,
      color: MUTED,
    });
    y -= 26;
  }

  data.articles.forEach((article, index) => {
    /** Bandeau de l'article — re-dessiné en haut de page si l'article déborde. */
    const drawStrip = (suite: boolean) => {
      const stripH = 20;
      page.drawRectangle({ x: LEFT, y: y - stripH, width: CONTENT_W, height: stripH, color: BRAND_SOFT });
      const qtyLabel = `${article.quantity} pièces`;
      const qtyW = w(qtyLabel, 9.5, bold) + 20;
      const title = `ARTICLE ${index + 1}${suite ? " (suite)" : ""}   ${article.description}`;
      text(ellipsize(title, CONTENT_W - qtyW - 20, 9.5, bold), {
        x: LEFT + 10,
        baseline: y - 13.5,
        size: 9.5,
        font: bold,
        color: BRAND,
      });
      text(qtyLabel, { x: RIGHT - qtyW, baseline: y - 13.5, size: 9.5, font: bold, color: BRAND, width: qtyW - 10, align: "right" });
      y -= stripH + 10;
    };

    ensure(130);
    drawStrip(false);
    continuation = () => drawStrip(true);

    const cells: Cell[] = [
      { label: "Modèle", value: article.modele ?? "non renseigné" },
      { label: "Tissu", value: article.tissu ?? "non renseigné" },
      { label: "Composition", value: article.composition ?? "-" },
      { label: "Grammage / laize", value: article.grammageLaize ?? "-" },
      { label: article.couleurLabel, value: article.couleur ?? "non renseignée" },
      { label: "Sections retenues", value: article.sections ?? "aucune" },
      { label: "Fiche patronnage (OT)", value: article.fiche ?? "-" },
      { label: "Visuel(s) joint(s)", value: article.visuels ?? "-" },
    ];
    drawCellGrid(cells, { x: LEFT + 10, width: CONTENT_W - 20, separators: true });

    y -= 10;
    drawSizeTable(article.sizes);
    continuation = null;
    y -= 20;
  });

  // ---------------------------------------------------------------------
  // 4. Sous-ODF générés par l'ODF
  // ---------------------------------------------------------------------
  {
    sectionTitle(
      `Sous-ODF générés (${data.sousOdf.length})`,
      data.sousOdf.length > 0 ? "Scanner le QR pour saisir la production au terminal" : undefined
    );

    if (data.sousOdf.length === 0) {
      text("Aucun sous-ODF : ils sont créés à la validation de l'ODF.", {
        x: LEFT,
        baseline: y - 10,
        size: VALUE_SIZE,
        color: MUTED,
      });
      y -= 26;
    } else {
      const cols: { label: string; width: number; align: "left" | "right" | "center" }[] = [
        { label: "N°", width: 26, align: "center" },
        { label: "Section", width: 122, align: "left" },
        { label: "Référence", width: 118, align: "left" },
        { label: "Prévu", width: 48, align: "right" },
        { label: "Réalisé", width: 50, align: "right" },
        { label: "Reste", width: 48, align: "right" },
        { label: "QR sous-ODF", width: CONTENT_W - 412, align: "center" },
      ];
      const headerH = 18;
      const rowH = 46;
      const colX = (index: number) => LEFT + cols.slice(0, index).reduce((sum, col) => sum + col.width, 0);

      const drawHeader = () => {
        page.drawRectangle({ x: LEFT, y: y - headerH, width: CONTENT_W, height: headerH, color: BRAND_SOFT });
        cols.forEach((col, i) => {
          text(col.label.toUpperCase(), {
            x: colX(i) + 6,
            baseline: y - 12,
            size: 7,
            font: bold,
            color: BRAND,
            width: col.width - 12,
            align: col.align,
          });
        });
        hLine(y - headerH, LEFT, RIGHT, 0.6, RULE);
        y -= headerH;
      };

      ensure(headerH + rowH + 4);
      drawHeader();
      continuation = () => drawHeader();

      data.sousOdf.forEach((wo, index) => {
        const pageBefore = page;
        ensure(rowH);
        const top = y;
        if (index % 2 === 1 && page === pageBefore) {
          page.drawRectangle({ x: LEFT, y: top - rowH, width: CONTENT_W, height: rowH, color: ZEBRA });
        }

        const reste = Math.max(0, wo.planned - wo.done);
        const values = [String(index + 1), wo.section, wo.reference, String(wo.planned), String(wo.done), String(reste)];
        values.forEach((value, i) => {
          const col = cols[i];
          const inner = col.width - 12;
          const cellFont = i === 1 || i === 2 ? bold : font;
          text(ellipsize(value, inner, 9.5, cellFont), {
            x: colX(i) + 6,
            baseline: top - rowH / 2 - 3,
            size: 9.5,
            font: cellFont,
            color: i === 5 && reste > 0 ? BRAND : INK,
            width: inner,
            align: col.align,
          });
        });

        // QR dans la dernière colonne : la hauteur de ligne (50 pt) est
        // dimensionnée pour lui, il ne peut pas déborder sur les voisines.
        const qr = sousOdfQr.get(wo.reference);
        if (qr) {
          const qrSize = 32;
          const lastCol = cols[cols.length - 1];
          const qrX = colX(cols.length - 1) + (lastCol.width - qrSize) / 2;
          page.drawImage(qr, { x: qrX, y: top - rowH / 2 - qrSize / 2, width: qrSize, height: qrSize });
        }

        // Filets verticaux de la ligne, puis filet de bas de ligne.
        for (let i = 1; i < cols.length; i += 1) {
          page.drawLine({ start: { x: colX(i), y: top }, end: { x: colX(i), y: top - rowH }, thickness: 0.5, color: HAIRLINE });
        }
        hLine(top - rowH, LEFT, RIGHT, 0.5, RULE);
        y = top - rowH;
      });
      continuation = null;
      y -= 22;
    }
  }

  // ---------------------------------------------------------------------
  // 5. Mentions et traçabilité
  // ---------------------------------------------------------------------
  if (data.surplusTraces.length > 0) {
    sectionTitle("Surplus tracé vs quantité demandée");
    drawCellGrid(
      data.surplusTraces.map(([taille, surplus]) => ({ label: `Taille ${taille}`, value: `+${surplus} pièces` })),
      { x: LEFT, width: CONTENT_W, separators: true }
    );
    y -= 14;
  }

  sectionTitle("Traçabilité du cycle de vie");
  {
    const cols = [
      { label: "Événement", width: 180 },
      { label: "Date", width: 150 },
      { label: "Par", width: CONTENT_W - 330 },
    ];
    const headerH = 18;
    const rowH = 20;
    const colX = (index: number) => LEFT + cols.slice(0, index).reduce((sum, col) => sum + col.width, 0);

    const drawHeader = () => {
      page.drawRectangle({ x: LEFT, y: y - headerH, width: CONTENT_W, height: headerH, color: BRAND_SOFT });
      cols.forEach((col, i) => {
        text(col.label.toUpperCase(), { x: colX(i) + 6, baseline: y - 12, size: 7, font: bold, color: BRAND });
      });
      hLine(y - headerH, LEFT, RIGHT, 0.6, RULE);
      y -= headerH;
    };

    ensure(headerH + rowH * 2);
    drawHeader();
    continuation = () => drawHeader();

    const rows =
      data.lifecycle.length > 0 ? data.lifecycle : [{ event: "Aucun événement enregistré", date: "-", by: "-" }];
    rows.forEach((row, index) => {
      const pageBefore = page;
      ensure(rowH);
      const top = y;
      if (index % 2 === 1 && page === pageBefore) {
        page.drawRectangle({ x: LEFT, y: top - rowH, width: CONTENT_W, height: rowH, color: ZEBRA });
      }
      [row.event, row.date, row.by].forEach((value, i) => {
        text(ellipsize(value, cols[i].width - 12, 9.5, font), {
          x: colX(i) + 6,
          baseline: top - 13.5,
          size: 9.5,
          font: i === 0 ? bold : font,
          color: i === 0 ? INK : MUTED,
        });
      });
      for (let i = 1; i < cols.length; i += 1) {
        page.drawLine({ start: { x: colX(i), y: top }, end: { x: colX(i), y: top - rowH }, thickness: 0.5, color: HAIRLINE });
      }
      hLine(top - rowH, LEFT, RIGHT, 0.5, RULE);
      y = top - rowH;
    });
    continuation = null;
    y -= 20;
  }

  if (data.clotureNote) {
    const pad = 10;
    const lines = wrap(data.clotureNote, CONTENT_W - pad * 2, VALUE_SIZE, font);
    const boxH = LABEL_LH + lines.length * VALUE_LH + pad * 2 - 2;
    ensure(boxH + 10);
    const top = y;
    page.drawRectangle({
      x: LEFT,
      y: top - boxH,
      width: CONTENT_W,
      height: boxH,
      color: BOX_FILL,
      borderColor: RULE,
      borderWidth: 0.9,
    });
    text("NOTE DE CLÔTURE", { x: LEFT + pad, baseline: top - pad - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
    let baseline = top - pad - LABEL_LH - VALUE_SIZE;
    for (const line of lines) {
      text(line, { x: LEFT + pad, baseline, size: VALUE_SIZE });
      baseline -= VALUE_LH;
    }
    y = top - boxH - 18;
  }

  // ---------------------------------------------------------------------
  // Pied de page — posé à la fin, quand le nombre de pages est connu.
  // ---------------------------------------------------------------------
  const pages = pdfDoc.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: LEFT, y: M_BOTTOM + 12 }, end: { x: RIGHT, y: M_BOTTOM + 12 }, thickness: 0.5, color: HAIRLINE });
    p.drawText(safe(`Seritex - ${data.reference} - généré le ${data.generatedAt}`), {
      x: LEFT,
      y: M_BOTTOM,
      size: 7,
      font,
      color: MUTED,
    });
    const pageLabel = safe(`Page ${index + 1} / ${pages.length}`);
    p.drawText(pageLabel, { x: RIGHT - font.widthOfTextAtSize(pageLabel, 7), y: M_BOTTOM, size: 7, font, color: MUTED });
  });

  return pdfDoc.save();
}

async function embedQr(pdfDoc: PDFDocument, url: string, width: number): Promise<PDFImage> {
  const png = await QRCode.toBuffer(url, { type: "png", width, margin: 1 });
  return pdfDoc.embedPng(png);
}
