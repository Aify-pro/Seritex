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
 * Principe : c'est un document de travail d'atelier, pas une note rédigée.
 * Donc des blocs cadrés, des tableaux à filets, une étiquette courte
 * au-dessus de chaque valeur — et une géométrie calculée avant de
 * dessiner, pour que plus rien ne se chevauche.
 *
 * Découpage du document (demande Ayman, 16/09) : la première page est la
 * page de pilotage de l'ODF — on doit pouvoir la détacher et savoir quoi
 * produire, en quelle quantité, et où en est chaque section. Le détail
 * d'un article n'a donc plus à se battre pour la place : chaque ligne
 * d'article part sur SA page.
 *
 *   Page 1   1. Bandeau       SERITEX + numéro d'ODF + pastille de statut.
 *            2. Cadre         Client / Commande sur deux colonnes, QR de
 *                             la fiche ODF calé à droite DANS le cadre.
 *            3. Articles      récapitulatif : désignation, modèle,
 *                             quantité, et la page où lire le détail.
 *            4. Sous-ODF      tableau (section, référence, prévu/fait/
 *                             reste) avec un QR par ligne pour la saisie
 *                             au terminal.
 *            5. Traçabilité   surplus tracé, circuit de validation, note
 *                              de clôture (migration 0050, 18/09).
 *   Page n   une page par article : en-tête de l'article, grille de
 *            caractéristiques, visuels joints, tableau des couleurs
 *            (pastille + référence, 3 zones par ligne), dispatching des
 *            tailles puis la maquette (si jointe) — tout sur la même page
 *            tant qu'il reste de la place (demande Ayman, 17/09), au lieu
 *            de forcer systématiquement la maquette sur une page à part.
 */

/** Une couleur posée sur l'article : soit la couleur unique (`zone` nul), soit une zone du modèle. */
export type OdfPdfColor = {
  /** Libellé de la zone (« Corps avant »), nul quand l'article porte une couleur unique. */
  zone: string | null;
  name: string;
  /** Référence de la couleur au référentiel — un hexadécimal CSS, qui sert aussi à peindre la pastille. */
  code: string | null;
};

export type OdfPdfArticle = {
  description: string;
  quantity: number;
  modele: string | null;
  tissu: string | null;
  composition: string | null;
  grammageLaize: string | null;
  /** « Couleur » ou « Couleurs par zone » selon la configuration de la ligne. */
  couleurLabel: string;
  couleurs: OdfPdfColor[];
  /**
   * Noms des sections retenues, dans leur ordre — chaque section porteuse
   * d'une info complémentaire l'affiche entre parenthèses (demande Ayman
   * 17/09) : le numéro d'OT pour Coupe, les zones imprimables pour
   * Sérigraphie. Remplace le champ « Fiche patronnage (OT) » séparé
   * ci-dessous, désormais redondant avec cette annotation.
   */
  sections: string | null;
  /** Fichiers d'exploitation à l'impression, tels quels (nom de fichier) — plusieurs possibles par article, contrairement à la maquette. */
  visuels: string | null;
  /**
   * Maquette (simulation) jointe à l'article (migration 0040) — une seule
   * par article. Contient les octets bruts (pas une URL : pdf-lib embarque
   * l'image dans son propre document) et son format déjà résolu par la
   * route depuis le type MIME ; absente si aucune maquette jointe ou si son
   * format n'est ni PNG ni JPEG.
   */
  maquette: { fileName: string; bytes: Uint8Array; format: "png" | "jpg" } | null;
  sizes: { taille: string; quantite: number }[];
};

export type OdfPdfSousOdf = {
  reference: string;
  section: string;
  /** Ordre d'atelier réel (sections.display_order) — regroupe et ordonne le tableau par section, pas par date planifiée. */
  sectionDisplayOrder: number;
  planned: number;
  done: number;
};

export type OdfPdfData = {
  reference: string;
  statusLabel: string;
  sheetUrl: string;
  generatedAt: string;
  client: {
    name: string;
    address: string | null;
  } | null;
  /** Date de validation de l'ODF (production_orders.launched_at) — demande Ayman 17/09, remplace le contact client dans le cadre. */
  dateValidation: string | null;
  /** Date de livraison prévue, saisie dès le devis (quotes.date_livraison_prevue, migration 0048) — demande Ayman 17/09. */
  dateLivraison: string | null;
  devis: string | null;
  totalQuantity: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  articles: OdfPdfArticle[];
  sousOdf: OdfPdfSousOdf[];
  surplusTraces: [string, number][];
  /**
   * Circuit de validation avant soumission (migration 0050, demande Ayman
   * 18/09) — remplace l'ancienne « Traçabilité du cycle de vie » : ce
   * document s'imprime avant le lancement en production, donc avant
   * qu'aucun événement de cycle de vie n'existe encore. Comptabilité,
   * infographie, un échantillon par article qui en porte un, et la
   * soumission par le chef de production — même forme {event,date,by} que
   * l'ancien tableau, réutilisée telle quelle.
   */
  circuitValidation: { event: string; date: string; by: string }[];
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
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.11, 0.09, 0.09);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.85, 0.83, 0.8);
const HAIRLINE = rgb(0.91, 0.9, 0.88);
const BOX_FILL = rgb(0.98, 0.977, 0.972);
const ZEBRA = rgb(0.965, 0.96, 0.953);
const SWATCH_FALLBACK = rgb(0.88, 0.87, 0.85);

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
    .replace(/[   ]/g, " ")
    .replace(/[^ -ÿ\n]/g, "?");
}

/**
 * Référence de couleur (`colors.code`) -> couleur PDF. Le référentiel
 * stocke un hexadécimal CSS (c'est lui qui peint déjà les pastilles de
 * l'application), mais rien n'empêche une saisie libre : on retourne alors
 * `null` et la pastille est tramée en gris plutôt que de mentir sur le ton.
 */
function parseColorCode(code: string | null | undefined): RGB | null {
  if (!code) return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(code.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const value = parseInt(hex, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

export async function buildOdfPdf(data: OdfPdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Ordre de fabrication ${safe(data.reference)}`);
  pdfDoc.setProducer("Seritex");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // QR d'en-tête, embarqué d'avance : le dessin qui suit est entièrement
  // synchrone, donc lisible de haut en bas. Plus qu'un seul QR par document
  // (demande Ayman, 17/09) : un chef de section le scanne depuis
  // /atelier/section, qui le redirige déjà vers les sous-ODF de SA section
  // — un QR par sous-ODF n'a donc plus d'utilité.
  const sheetQr = await embedQr(pdfDoc, data.sheetUrl, 300);

  // Maquettes (migration 0040) : embarquées elles aussi d'avance, indexées
  // par article. Un format déclaré PNG/JPEG mais illisible par pdf-lib
  // (fichier corrompu) laisse simplement cet article sans image — géré
  // plus bas par une mention texte, jamais par un échec du PDF entier.
  const maquetteImages = new Map<number, PDFImage>();
  for (let i = 0; i < data.articles.length; i += 1) {
    const maquette = data.articles[i].maquette;
    if (!maquette) continue;
    try {
      const image = maquette.format === "png" ? await pdfDoc.embedPng(maquette.bytes) : await pdfDoc.embedJpg(maquette.bytes);
      maquetteImages.set(i, image);
    } catch {
      // format non pris en charge par pdf-lib — l'article reste sans image de maquette
    }
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
      /** Page cible — par défaut la page courante ; sert aux renvois remplis après coup. */
      onPage?: PDFPage;
    }
  ) {
    const f = opts.font ?? font;
    const content = safe(value);
    let x = opts.x;
    if (opts.width !== undefined && opts.align === "right") x = opts.x + opts.width - w(content, opts.size, f);
    if (opts.width !== undefined && opts.align === "center") x = opts.x + (opts.width - w(content, opts.size, f)) / 2;
    (opts.onPage ?? page).drawText(content, { x, y: opts.baseline, size: opts.size, font: f, color: opts.color ?? INK });
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
      color: WHITE,
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

  /** Ouvre une page vierge (en-tête allégé posé, curseur replacé en haut). */
  function startPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    drawContinuationHeader();
  }

  function newPage() {
    startPage();
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
  /** `size` : taille de police de la VALEUR, pour les grilles qui veulent un texte plus compact (page article, demande Ayman 17/09) sans toucher VALUE_SIZE — partagé avec le reste du document (page 1 notamment). */
  type Cell = { label: string; value: string; size?: number };

  function cellHeight(cell: Cell, width: number): number {
    const size = cell.size ?? VALUE_SIZE;
    return LABEL_LH + wrap(cell.value, width, size, font).length * VALUE_LH + CELL_PAD_BOTTOM;
  }

  function drawCell(cell: Cell, x: number, top: number, width: number) {
    const size = cell.size ?? VALUE_SIZE;
    text(cell.label.toUpperCase(), { x, baseline: top - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
    let baseline = top - LABEL_LH - VALUE_SIZE;
    for (const line of wrap(cell.value, width, size, font)) {
      text(line, { x, baseline, size });
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
   * Couleurs de l'article — le point dur de la lecture en atelier : il faut
   * voir d'un coup d'oeil QUELLE zone porte QUEL ton. D'où un vrai tableau
   * à trois colonnes de paires (deux auparavant, demande Ayman 17/09) : à
   * gauche la zone (« Corps avant »), à droite la couleur sous forme de
   * bouton (pastille peinte au ton réel + nom) suivi de sa référence. Une
   * couleur unique occupe une ligne pleine.
   */
  function drawColorTable(label: string, colors: OdfPdfColor[]) {
    const x = LEFT + 10;
    const width = CONTENT_W - 20;
    ensure(46);
    text(label.toUpperCase(), { x, baseline: y - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
    y -= LABEL_LH + 4;

    if (colors.length === 0) {
      ensure(20);
      text("non renseignée", { x, baseline: y - VALUE_SIZE, size: VALUE_SIZE, color: MUTED });
      y -= VALUE_LH + 4;
      return;
    }

    // Une seule couleur : pleine largeur, sinon trois zones/couleurs par
    // ligne (demande Ayman, 17/09 — deux colonnes auparavant) : plus de
    // zones visibles d'un coup d'oeil, au prix d'une police réduite pour
    // que chaque triplet zone/nom/référence tienne dans une cellule plus
    // étroite.
    const perRow = colors.length === 1 ? 1 : 3;
    const cellW = width / perRow;
    const rowH = 26;

    // La colonne des zones se cale sur le plus long libellé réel : chaque
    // point qu'elle ne prend pas revient au nom de la couleur, qui est ce
    // qu'on lit, pas ce qu'on devine.
    const zoneLabelOf = (color: OdfPdfColor) => color.zone ?? "Couleur unique";
    const zoneSize = 7.5;
    const widestLabel = Math.max(...colors.map((color) => w(zoneLabelOf(color), zoneSize, bold)));
    const zoneW = Math.min(perRow === 1 ? 150 : cellW * 0.36, Math.max(52, widestLabel + 12));

    const drawColorCell = (color: OdfPdfColor, top: number, row: number, col: number) => {
      const cellX = x + cellW * col;
      const middle = top - rowH * row - rowH / 2;

      // Colonne de gauche : la zone. Sur une couleur unique la mention
      // reste explicite pour ne pas laisser croire à une zone manquante.
      text(ellipsize(zoneLabelOf(color), zoneW - 12, zoneSize, bold), {
        x: cellX + 7,
        baseline: middle - 2.5,
        size: zoneSize,
        font: bold,
        color: INK,
      });

      // Colonne de droite : le bouton de couleur, puis la référence. Le nom
      // sert en premier (c'est lui qu'on lit pour teindre, la référence
      // n'est qu'une confirmation) — la référence se rogne avant lui, plus
      // fort qu'avant vu la place rendue plus rare par la 3e colonne.
      const swatch = parseColorCode(color.code);
      const available = cellW - zoneW - 10;
      const reference = ellipsize(safe(color.code).trim() || "sans référence", Math.min(46, available * 0.3), 6.5, font);
      const refW = w(reference, 6.5, font) + 5;
      const buttonX = cellX + zoneW;
      const buttonMaxW = available - refW;
      const name = ellipsize(color.name || "-", Math.max(30, buttonMaxW - 20), 8, bold);
      const buttonW = Math.min(buttonMaxW, 20 + w(name, 8, bold));
      const buttonH = 16;

      page.drawRectangle({
        x: buttonX,
        y: middle - buttonH / 2,
        width: buttonW,
        height: buttonH,
        color: WHITE,
        borderColor: RULE,
        borderWidth: 0.7,
      });
      page.drawRectangle({
        x: buttonX + 4,
        y: middle - 5,
        width: 10,
        height: 10,
        color: swatch ?? SWATCH_FALLBACK,
        borderColor: RULE,
        borderWidth: 0.5,
      });
      text(name, { x: buttonX + 18, baseline: middle - 2.5, size: 8, font: bold, color: INK });
      // Référence hors palette (ni #RGB ni #RRGGBB) : la pastille est
      // neutre, la référence passe en alerte plutôt que de laisser croire
      // que le gris affiché est le ton à teindre.
      text(reference, {
        x: buttonX + buttonW + 5,
        baseline: middle - 2.2,
        size: 6.5,
        color: swatch ? MUTED : rgb(0.65, 0.35, 0.2),
      });
    };

    // Le tableau se découpe en blocs autonomes (contour + filets par bloc) :
    // un modèle à beaucoup de zones repart en haut de la page suivante au
    // lieu d'écrire sous le pied de page.
    let index = 0;
    while (index < colors.length) {
      if (y - rowH < M_BOTTOM + 16) newPage();
      const roomRows = Math.max(1, Math.floor((y - (M_BOTTOM + 16)) / rowH));
      const blockRows = Math.min(Math.ceil((colors.length - index) / perRow), roomRows);
      const block = colors.slice(index, index + blockRows * perRow);
      const top = y;

      block.forEach((color, i) => drawColorCell(color, top, Math.floor(i / perRow), i % perRow));

      // Filets : contour du bloc, séparation des lignes, séparation des colonnes.
      const tableH = rowH * blockRows;
      page.drawRectangle({ x, y: top - tableH, width, height: tableH, borderColor: RULE, borderWidth: 0.6 });
      for (let row = 1; row < blockRows; row += 1) {
        hLine(top - rowH * row, x, x + width, 0.5, HAIRLINE);
      }
      for (let col = 1; col < perRow; col += 1) {
        page.drawLine({
          start: { x: x + cellW * col, y: top },
          end: { x: x + cellW * col, y: top - tableH },
          thickness: 0.5,
          color: RULE,
        });
      }

      y = top - tableH;
      index += blockRows * perRow;
    }
  }

  /**
   * Dispatching des tailles : un vrai tableau à filets (une colonne par
   * taille, une ligne « demandé », une colonne « total »), toujours sur une
   * seule ligne — colonnes et police se resserrent avec le nombre de
   * tailles plutôt que de scinder le tableau en plusieurs blocs.
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

    // Toujours UNE seule ligne (demande Ayman, 17/09 — la table se scindait
    // auparavant en plusieurs blocs empilés si les tailles ne tenaient pas
    // sur la largeur) : les colonnes — et leur police, en dessous d'un
    // certain seuil — se resserrent avec le nombre de tailles plutôt que de
    // continuer sur une deuxième ligne.
    const headW = 58;
    const n = sizes.length + 1; // + colonne TOTAL
    const colW = Math.max(15, Math.min(60, (width - headW) / n));
    const tableW = headW + colW * n;
    const tailleSize = colW >= 34 ? 8.5 : Math.max(5.5, colW / 4.2);
    const qtySize = colW >= 34 ? 9.5 : Math.max(6, colW / 3.6);
    const rowH = 16;

    ensure(rowH * 2 + 8);
    const top = y;

    page.drawRectangle({ x, y: top - rowH, width: tableW, height: rowH, color: BRAND_SOFT });
    text("TAILLE", { x: x + 6, baseline: top - 11, size: 7, font: bold, color: BRAND });
    text("DEMANDÉ", { x: x + 6, baseline: top - rowH - 11, size: 7, font: bold, color: MUTED });

    sizes.forEach((size, i) => {
      const cx = x + headW + colW * i;
      text(ellipsize(size.taille, colW - 4, tailleSize, bold), {
        x: cx,
        baseline: top - 11,
        size: tailleSize,
        font: bold,
        width: colW,
        align: "center",
      });
      text(String(size.quantite), { x: cx, baseline: top - rowH - 11, size: qtySize, width: colW, align: "center" });
    });

    const totalX = x + headW + colW * sizes.length;
    const total = sizes.reduce((sum, size) => sum + size.quantite, 0);
    page.drawRectangle({ x: totalX, y: top - rowH * 2, width: colW, height: rowH, color: ZEBRA });
    text("TOTAL", { x: totalX, baseline: top - 11, size: 7, font: bold, color: BRAND, width: colW, align: "center" });
    text(String(total), { x: totalX, baseline: top - rowH - 11, size: qtySize, font: bold, width: colW, align: "center" });

    // Filets : contour, séparation des deux lignes, colonnes.
    page.drawRectangle({ x, y: top - rowH * 2, width: tableW, height: rowH * 2, borderColor: RULE, borderWidth: 0.6 });
    hLine(top - rowH, x, x + tableW, 0.6, RULE);
    for (let i = 0; i <= n; i += 1) {
      const cx = x + headW + colW * i;
      page.drawLine({ start: { x: cx, y: top }, end: { x: cx, y: top - rowH * 2 }, thickness: 0.5, color: RULE });
    }

    y = top - rowH * 2;
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

    // Contact client (téléphone/e-mail/SIRET) retiré du cadre (demande Ayman
    // 17/09) — remplacé par les deux dates qui comptent pour l'atelier :
    // quand l'ODF a été validé, et quand le client attend sa commande.
    // Colonnes rééquilibrées à 4 cellules chacune (5/4 avant) : le cadre en
    // ressort plus court, pas plus long, malgré les deux dates ajoutées.
    const clientCells: Cell[] = [
      { label: "Client", value: data.client?.name ?? "-" },
      { label: "Adresse", value: data.client?.address ?? "-" },
      { label: "Date", value: data.dateValidation ?? "-" },
      { label: "Date de livraison", value: data.dateLivraison ?? "-" },
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
  // 3. Récapitulatif des articles (première page) — ce qu'il y a dans
  //    l'ODF et en quelle quantité. Le détail part sur une page dédiée,
  //    dont le numéro est écrit ici après coup (renvois `detailRefs`).
  // ---------------------------------------------------------------------
  const articlePages: (PDFPage | null)[] = data.articles.map(() => null);
  const detailRefs: { page: PDFPage; x: number; baseline: number; width: number; index: number }[] = [];

  {
    sectionTitle(
      `Articles de l'ODF (${data.articles.length})`,
      data.articles.length > 0 ? "Détail complet de chaque article sur sa propre page" : undefined
    );

    if (data.articles.length === 0) {
      text("Aucun article configuré sur cet ordre de fabrication.", {
        x: LEFT,
        baseline: y - 10,
        size: VALUE_SIZE,
        color: MUTED,
      });
      y -= 26;
    } else {
      const cols: { label: string; width: number; align: "left" | "right" | "center" }[] = [
        { label: "N°", width: 26, align: "center" },
        { label: "Désignation", width: CONTENT_W - 26 - 132 - 58 - 52, align: "left" },
        { label: "Modèle", width: 132, align: "left" },
        { label: "Quantité", width: 58, align: "right" },
        { label: "Détail", width: 52, align: "center" },
      ];
      const headerH = 18;
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

      ensure(headerH + 30);
      drawHeader();
      continuation = () => drawHeader();

      data.articles.forEach((article, index) => {
        const descLines = wrap(article.description, cols[1].width - 12, 9.5, bold);
        const modelLines = wrap(article.modele ?? "-", cols[2].width - 12, 9, font);
        const rowH = Math.max(24, Math.max(descLines.length, modelLines.length) * VALUE_LH + 10);

        const pageBefore = page;
        ensure(rowH);
        const top = y;
        if (index % 2 === 1 && page === pageBefore) {
          page.drawRectangle({ x: LEFT, y: top - rowH, width: CONTENT_W, height: rowH, color: ZEBRA });
        }

        text(String(index + 1), {
          x: colX(0) + 6,
          baseline: top - 16,
          size: 9.5,
          font: bold,
          color: BRAND,
          width: cols[0].width - 12,
          align: "center",
        });
        let baseline = top - 16;
        for (const line of descLines) {
          text(line, { x: colX(1) + 6, baseline, size: 9.5, font: bold });
          baseline -= VALUE_LH;
        }
        baseline = top - 16;
        for (const line of modelLines) {
          text(line, { x: colX(2) + 6, baseline, size: 9, color: MUTED });
          baseline -= VALUE_LH;
        }
        text(`${article.quantity}`, {
          x: colX(3) + 6,
          baseline: top - 16,
          size: 10.5,
          font: bold,
          width: cols[3].width - 12,
          align: "right",
        });
        // Renvoi vers la page de détail : la place est réservée ici, le
        // numéro n'existe qu'une fois les pages d'articles posées.
        detailRefs.push({ page, x: colX(4) + 6, baseline: top - 16, width: cols[4].width - 12, index });

        for (let i = 1; i < cols.length; i += 1) {
          page.drawLine({ start: { x: colX(i), y: top }, end: { x: colX(i), y: top - rowH }, thickness: 0.5, color: HAIRLINE });
        }
        hLine(top - rowH, LEFT, RIGHT, 0.5, RULE);
        y = top - rowH;
      });
      continuation = null;

      // Ligne de total : c'est le chiffre que l'atelier vérifie en premier.
      const totalH = 20;
      ensure(totalH + 4);
      const totalTop = y;
      page.drawRectangle({ x: LEFT, y: totalTop - totalH, width: CONTENT_W, height: totalH, color: BRAND_SOFT });
      text("TOTAL À PRODUIRE", { x: colX(1) + 6, baseline: totalTop - 13.5, size: 8, font: bold, color: BRAND });
      const totalArticles = data.articles.reduce((sum, article) => sum + article.quantity, 0);
      text(`${totalArticles}`, {
        x: colX(3) + 6,
        baseline: totalTop - 13.5,
        size: 10.5,
        font: bold,
        color: BRAND,
        width: cols[3].width - 12,
        align: "right",
      });
      page.drawRectangle({ x: LEFT, y: totalTop - totalH, width: CONTENT_W, height: totalH, borderColor: RULE, borderWidth: 0.6 });
      y = totalTop - totalH - 22;

      // Écart avec le total porté par l'ODF : signalé, jamais corrigé en silence.
      if (totalArticles !== data.totalQuantity) {
        ensure(18);
        text(`Quantité totale déclarée sur l'ODF : ${data.totalQuantity} pièces.`, {
          x: LEFT,
          baseline: y,
          size: 7.5,
          color: MUTED,
        });
        y -= 20;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 4. Sous-ODF générés par l'ODF, groupés par section (demande Ayman,
  //    17/09) : un chef de section scanne le QR d'en-tête depuis
  //    /atelier/section et retrouve directement les sous-ODF de SA
  //    section — plus besoin d'un QR par ligne (retiré ci-dessus), ni
  //    d'une colonne "Section" puisqu'elle titre désormais chaque bloc.
  // ---------------------------------------------------------------------
  {
    sectionTitle(`Sous-ODF générés (${data.sousOdf.length})`);

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
        { label: "N°", width: 30, align: "center" },
        { label: "Référence", width: 180, align: "left" },
        { label: "Prévu", width: (CONTENT_W - 30 - 180) / 3, align: "right" },
        { label: "Réalisé", width: (CONTENT_W - 30 - 180) / 3, align: "right" },
        { label: "Reste", width: (CONTENT_W - 30 - 180) / 3, align: "right" },
      ];
      const headerH = 18;
      const rowH = 22;
      const colX = (index: number) => LEFT + cols.slice(0, index).reduce((sum, col) => sum + col.width, 0);

      const drawColHeader = () => {
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

      // Un groupe par section, dans l'ordre réel de passage en atelier
      // (sections.display_order) — pas l'ordre de planned_start, qui
      // mélangerait les sections entre elles.
      const groups = new Map<string, { displayOrder: number; rows: OdfPdfSousOdf[] }>();
      for (const wo of data.sousOdf) {
        const group = groups.get(wo.section) ?? { displayOrder: wo.sectionDisplayOrder, rows: [] };
        group.rows.push(wo);
        groups.set(wo.section, group);
      }
      const orderedGroups = [...groups.entries()].sort((a, b) => a[1].displayOrder - b[1].displayOrder);

      orderedGroups.forEach(([sectionName, group], groupIndex) => {
        ensure(20 + headerH + rowH + 4);
        text(sectionName.toUpperCase(), { x: LEFT, baseline: y - 9, size: 9.5, font: bold, color: BRAND });
        y -= 14;
        hLine(y, LEFT, RIGHT, 0.5, RULE);
        y -= 10;

        drawColHeader();
        continuation = drawColHeader;

        group.rows.forEach((wo, index) => {
          const pageBefore = page;
          ensure(rowH);
          const top = y;
          if (index % 2 === 1 && page === pageBefore) {
            page.drawRectangle({ x: LEFT, y: top - rowH, width: CONTENT_W, height: rowH, color: ZEBRA });
          }

          const reste = Math.max(0, wo.planned - wo.done);
          const values = [String(index + 1), wo.reference, String(wo.planned), String(wo.done), String(reste)];
          values.forEach((value, i) => {
            const col = cols[i];
            const inner = col.width - 12;
            const cellFont = i === 1 ? bold : font;
            text(ellipsize(value, inner, 9.5, cellFont), {
              x: colX(i) + 6,
              baseline: top - rowH / 2 - 3,
              size: 9.5,
              font: cellFont,
              color: i === 4 && reste > 0 ? BRAND : INK,
              width: inner,
              align: col.align,
            });
          });

          for (let i = 1; i < cols.length; i += 1) {
            page.drawLine({ start: { x: colX(i), y: top }, end: { x: colX(i), y: top - rowH }, thickness: 0.5, color: HAIRLINE });
          }
          hLine(top - rowH, LEFT, RIGHT, 0.5, RULE);
          y = top - rowH;
        });
        continuation = null;
        if (groupIndex < orderedGroups.length - 1) y -= 16;
      });
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

  sectionTitle("Circuit de validation");
  {
    const cols = [
      { label: "Étape", width: 220 },
      { label: "Date / statut", width: 150 },
      { label: "Par", width: CONTENT_W - 370 },
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

    const rows = data.circuitValidation;
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
  // 6. Une page par article — la fiche de travail de la ligne.
  // ---------------------------------------------------------------------
  data.articles.forEach((article, index) => {
    /** Bandeau compact, re-dessiné en haut de page si l'article déborde. */
    const drawStrip = () => {
      const stripH = 17;
      page.drawRectangle({ x: LEFT, y: y - stripH, width: CONTENT_W, height: stripH, color: BRAND_SOFT });
      const qtyLabel = `${article.quantity} pièces`;
      const qtyW = w(qtyLabel, 8.5, bold) + 18;
      const title = `ARTICLE ${index + 1} (suite)   ${article.description}`;
      text(ellipsize(title, CONTENT_W - qtyW - 18, 8.5, bold), {
        x: LEFT + 9,
        baseline: y - 11.5,
        size: 8.5,
        font: bold,
        color: BRAND,
      });
      text(qtyLabel, { x: RIGHT - qtyW, baseline: y - 11.5, size: 8.5, font: bold, color: BRAND, width: qtyW - 9, align: "right" });
      y -= stripH + 9;
    };

    // Chaque article ouvre SA page : la place est garantie, plus besoin de
    // tasser la grille ou de couper un tableau au milieu.
    startPage();
    articlePages[index] = page;

    // Bandeau titre resserré (demande Ayman 17/09, comme le reste de la
    // page article) : titre 11 au lieu de 13, badge quantité 9 au lieu de
    // 10, moins de remplissage vertical — les deux cases entre l'en-tête et
    // le premier cadre en profitent aussi, le tout raccourcit la page.
    {
      const qtyLabel = `${article.quantity} pièces`;
      const qtyW = w(qtyLabel, 9, bold) + 20;
      const titleLines = wrap(article.description, CONTENT_W - qtyW - 30, 11, bold).slice(0, 2);
      const headH = 17 + titleLines.length * 14 + 8;
      const top = y;

      page.drawRectangle({ x: LEFT, y: top - headH, width: CONTENT_W, height: headH, color: BRAND_SOFT });
      text(`ARTICLE ${index + 1} / ${data.articles.length}`, {
        x: LEFT + 12,
        baseline: top - 13,
        size: 7,
        font: bold,
        color: MUTED,
      });
      let baseline = top - 27;
      for (const line of titleLines) {
        text(line, { x: LEFT + 12, baseline, size: 11, font: bold, color: BRAND });
        baseline -= 14;
      }
      const badgeH = 18;
      const badgeY = top - headH / 2 - badgeH / 2;
      page.drawRectangle({ x: RIGHT - qtyW - 12, y: badgeY, width: qtyW, height: badgeH, color: BRAND });
      text(qtyLabel, {
        x: RIGHT - qtyW - 12,
        baseline: badgeY + 5.5,
        size: 9,
        font: bold,
        color: WHITE,
        width: qtyW,
        align: "center",
      });
      y = top - headH - 12;
    }

    continuation = drawStrip;

    // Police réduite (8.5 contre 9.5 par défaut) sur toute la grille de
    // caractéristiques de l'article — demande Ayman 17/09, comme le
    // bandeau ci-dessus. « Fiche patronnage (OT) » disparaît : son numéro
    // s'affiche désormais entre parenthèses à côté de « Coupe », dans
    // Sections retenues (construit côté route).
    const cells: Cell[] = [
      { label: "Modèle", value: article.modele ?? "non renseigné", size: 8.5 },
      { label: "Tissu", value: article.tissu ?? "non renseigné", size: 8.5 },
      { label: "Composition", value: article.composition ?? "-", size: 8.5 },
      { label: "Grammage / laize", value: article.grammageLaize ?? "-", size: 8.5 },
    ];
    drawCellGrid(cells, { x: LEFT + 10, width: CONTENT_W - 20, separators: true });

    // Sections retenues : hors grille deux-colonnes, pleine largeur — les
    // annotations entre parenthèses (numéro d'OT sur Coupe, zones
    // imprimables sur Sérigraphie, demande Ayman 17/09) peuvent allonger la
    // liste ; la confiner à une demi-largeur l'aurait fait déborder sur
    // plusieurs lignes bien plus souvent qu'avant cet ajout.
    {
      const sx = LEFT + 10;
      const sw = CONTENT_W - 20;
      const sectionsLines = wrap(article.sections ?? "aucune", sw, 8.5, font);
      ensure(LABEL_LH + sectionsLines.length * VALUE_LH + CELL_PAD_BOTTOM);
      text("SECTIONS RETENUES", { x: sx, baseline: y - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
      let baseline = y - LABEL_LH - 8.5;
      for (const line of sectionsLines) {
        text(line, { x: sx, baseline, size: 8.5 });
        baseline -= VALUE_LH;
      }
      y -= LABEL_LH + sectionsLines.length * VALUE_LH + CELL_PAD_BOTTOM;
    }

    // Visuel(s) joint(s) : hors grille deux-colonnes (demande Ayman, 17/09)
    // — plusieurs fichiers possibles par article, listés sur UNE seule
    // ligne séparés par une virgule (déjà fait côté route) plutôt
    // qu'empilés/coupés par le retour à la ligne de la grille ; police
    // réduite (7.5 contre 9.5 pour les autres cadres) puisque c'est une
    // liste de noms de fichiers, pas une donnée à lire en premier.
    {
      const vx = LEFT + 10;
      const vw = CONTENT_W - 20;
      ensure(LABEL_LH + 9.5 + CELL_PAD_BOTTOM);
      text("VISUEL(S) JOINT(S)", { x: vx, baseline: y - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
      text(ellipsize(article.visuels ?? "-", vw, 7.5, font), { x: vx, baseline: y - LABEL_LH - 7.5, size: 7.5, color: INK });
      y -= LABEL_LH + 7.5 + CELL_PAD_BOTTOM;
    }

    y -= 14;
    drawColorTable(article.couleurLabel, article.couleurs);
    y -= 16;
    drawSizeTable(article.sizes);

    // Maquette (migration 0040) : sur LA MÊME page que les informations de
    // l'article (demande Ayman, 17/09) — avant, `startPage()` ici forçait
    // systématiquement une nouvelle page, même quand il restait largement
    // la place. `continuation` reste posé sur `drawStrip` : si le
    // dispatching a rempli la page jusqu'au bord et qu'`ensure` déclenche
    // malgré tout un saut de page, le bandeau "(suite)" continue de
    // s'afficher plutôt qu'une page nue. Mise à l'échelle "contain" dans
    // l'espace vertical restant, jamais déformée, jamais au-delà de sa
    // page.
    const maquetteImage = maquetteImages.get(index);
    if (maquetteImage && article.maquette) {
      y -= 14;
      ensure(90);
      const mx = LEFT + 10;
      const mw = CONTENT_W - 20;
      text("MAQUETTE", { x: mx, baseline: y - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
      text(article.maquette.fileName, { x: mx, baseline: y - LABEL_SIZE, size: 7.5, color: MUTED, width: mw, align: "right" });
      y -= LABEL_LH + 8;

      const maxWidth = mw;
      const maxHeight = y - (M_BOTTOM + 16);
      const ratio = Math.min(maxWidth / maquetteImage.width, maxHeight / maquetteImage.height);
      const imgWidth = maquetteImage.width * ratio;
      const imgHeight = maquetteImage.height * ratio;
      page.drawImage(maquetteImage, { x: mx + (maxWidth - imgWidth) / 2, y: y - imgHeight, width: imgWidth, height: imgHeight });
    }
    continuation = null;
  });

  // Renvois « page du détail » du récapitulatif, maintenant que chaque
  // article a sa page.
  const pages = pdfDoc.getPages();
  for (const ref of detailRefs) {
    const target = articlePages[ref.index];
    const pageNumber = target ? pages.indexOf(target) + 1 : 0;
    text(pageNumber > 0 ? `p. ${pageNumber}` : "-", {
      x: ref.x,
      baseline: ref.baseline,
      size: 8.5,
      color: MUTED,
      width: ref.width,
      align: "center",
      onPage: ref.page,
    });
  }

  // ---------------------------------------------------------------------
  // Pied de page — posé à la fin, quand le nombre de pages est connu.
  // ---------------------------------------------------------------------
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
