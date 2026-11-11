import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { getLogoPngBytes } from "./logo";

/**
 * Ordre de tracé imprimable (fiche de placement) : ce que le coupeur doit
 * savoir pour monter et couper ses matelas.
 *
 *   Page 1     Récapitulatif de l'ordre : article(s), tissu, produits finis
 *              du regroupement (ODF, client, couleur, quantités par taille,
 *              pièces et leur couleur) et liste des tracés.
 *   Page n     Une fiche matelas par tracé (hors tracés annulés) : forme du
 *              tissu, dimensions, rouleaux prévus, couches par article,
 *              pièces par couche et totaux, dessin du tracé (hors échelle),
 *              puis la zone à remplir à la coupe.
 *
 * Avec un seul tracé demandé (fiche matelas depuis le module Coupe), le
 * document se réduit à sa fiche matelas.
 *
 * Comme odf-pdf.ts : la route lit la base et aplatit, ce module ne fait que
 * dessiner.
 */

export type OrdreTracePdfArticle = {
  odf: string | null;
  client: string | null;
  article: string;
  couleur: string | null;
  quantite: number | null;
  /** Vêtements par taille (libellé de taille → quantité). */
  tailles: [string, number][];
  /** Pièces (semi-finis) de l'article et leur couleur, ordre regroupé seulement. */
  pieces: { nom: string; couleur: string | null }[];
  odfAnnule: boolean;
};

export type OrdreTracePdfTrace = {
  reference: string;
  statut: string;
  forme: string;
  referencePatron: string | null;
  longueurCm: number | null;
  laizeCm: number | null;
  /** Total des couches (somme des couches par article, ou nombre de plis). */
  couches: number | null;
  /** Tissus prévus par la PAO sur le tracé (0180) : « JE180BLE - Jersey 180 g · Bleu ». */
  tissusPrevus: string[];
  /** Couches par tissu (grammage, couleur, référence) et ODF concernés, ordre regroupé. */
  tissus: { libelle: string; couches: number; odfs: string }[];
  /** Couches par article (ordre regroupé). */
  couchesParArticle: { libelle: string; couleur: string | null; couches: number; odfAnnule: boolean }[];
  /** Pièces posées par couche : pièce × taille × quantité. */
  piecesParCouche: { piece: string; taille: string; quantite: number }[];
  rouleaux: { code: string; laizeCm: number | null; bain: string | null; poidsKg: number | null }[];
  url: string;
  /** Dessin du tracé (PDF d'une page, hors échelle), s'il a pu être généré. */
  dessin: Uint8Array | null;
};

export type OrdreTracePdfData = {
  numeroOt: string;
  statutLabel: string;
  regroupee: boolean;
  designation: string;
  modele: string | null;
  tissu: string | null;
  grammage: number | null;
  laizeUtileCm: number | null;
  couleur: string | null;
  client: string | null;
  dateEmission: string | null;
  dateRetour: string | null;
  contraintes: string | null;
  observations: string | null;
  articles: OrdreTracePdfArticle[];
  traces: OrdreTracePdfTrace[];
  url: string;
  generatedAt: string;
  /** Une seule fiche matelas (module Coupe) : pas de page récapitulative. */
  ficheMatelasSeule: boolean;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const LEFT = M;
const RIGHT = PAGE_W - M;
const CONTENT_W = RIGHT - LEFT;
const BRAND = rgb(0, 0.251, 0.565);
const INK = rgb(0.11, 0.09, 0.09);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.85, 0.83, 0.8);
const BOX_FILL = rgb(0.98, 0.977, 0.972);
const ZEBRA = rgb(0.965, 0.96, 0.953);
const DANGER = rgb(0.7, 0.1, 0.1);
/** Bas de la zone utile (pied de page). */
const BAS = M + 20;
/** Hauteur de « À remplir à la coupe » : titre + cinq cadres + signatures. */
const ZONE_SAISIE = 25 + 34 + 26 + 20 + 20 + 34 + 30;

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

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const n = (v: number | null | undefined) => (v === null || v === undefined ? "-" : nf.format(v).replace(/[  ]/g, " "));
export const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;

type Col = { title: string; width: number; align?: "left" | "right" };

export async function buildOrdreTracePdf(data: OrdreTracePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Ordre de tracé ${safe(data.numeroOt)}`);
  pdf.setProducer("Seritex");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(await getLogoPngBytes());

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  let entete: () => void = () => {};

  const w = (s: string, size: number, f: PDFFont) => f.widthOfTextAtSize(safe(s), size);
  function text(s: string, x: number, baseline: number, size = 9, f: PDFFont = font, color: RGB = INK) {
    page.drawText(safe(s), { x, y: baseline, size, font: f, color });
  }
  function wrap(s: string, maxWidth: number, size: number, f: PDFFont): string[] {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const essai = cur ? `${cur} ${word}` : word;
        if (w(essai, size, f) <= maxWidth || !cur) cur = essai;
        else {
          out.push(cur);
          cur = word;
        }
      }
      out.push(cur);
    }
    return out.length ? out : [""];
  }
  function nouvellePage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
    entete();
  }
  function place(h: number) {
    if (y - h < BAS) nouvellePage();
  }
  function titre(s: string) {
    place(30);
    y -= 16;
    text(s.toUpperCase(), LEFT, y, 9.5, bold, BRAND);
    y -= 5;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.8, color: BRAND });
    y -= 4;
  }

  /** Grille de caractéristiques : libellé au-dessus, valeur dessous. */
  function grille(items: [string, string | null][], colonnes = 3) {
    const visibles = items.filter(([, v]) => v !== null && v !== "");
    const cw = CONTENT_W / colonnes;
    for (let i = 0; i < visibles.length; i += colonnes) {
      const rang = visibles.slice(i, i + colonnes);
      const lignes = rang.map(([, v]) => wrap(v ?? "", cw - 10, 9.5, bold));
      const h = 14 + Math.max(...lignes.map((l) => l.length)) * 12;
      place(h);
      page.drawRectangle({ x: LEFT, y: y - h, width: CONTENT_W, height: h, color: BOX_FILL, borderColor: RULE, borderWidth: 0.5 });
      rang.forEach(([label], j) => {
        const x = LEFT + j * cw + 6;
        text(label, x, y - 10, 7, font, MUTED);
        lignes[j].forEach((l, k) => text(l, x, y - 22 - k * 12, 9.5, bold));
      });
      y -= h;
    }
  }

  /** Tableau à filets ; une ligne peut porter plusieurs lignes de texte. */
  function tableau(cols: Col[], rows: (string | { v: string; color?: RGB; bold?: boolean })[][], size = 8.5) {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * CONTENT_W);
    const dessinerEnTete = () => {
      place(18);
      page.drawRectangle({ x: LEFT, y: y - 16, width: CONTENT_W, height: 16, color: rgb(0.93, 0.92, 0.9) });
      let x = LEFT;
      cols.forEach((c, i) => {
        const tx = c.align === "right" ? x + widths[i] - 4 - w(c.title, 7.5, bold) : x + 4;
        text(c.title, tx, y - 11, 7.5, bold, MUTED);
        x += widths[i];
      });
      y -= 16;
    };
    dessinerEnTete();
    rows.forEach((row, r) => {
      const cells = row.map((c) => (typeof c === "string" ? { v: c } : c));
      const lignes = cells.map((c, i) => wrap(c.v, widths[i] - 8, size, c.bold ? bold : font));
      const h = 6 + Math.max(...lignes.map((l) => l.length)) * (size + 3);
      if (y - h < BAS) {
        nouvellePage();
        dessinerEnTete();
      }
      if (r % 2 === 1) page.drawRectangle({ x: LEFT, y: y - h, width: CONTENT_W, height: h, color: ZEBRA });
      let x = LEFT;
      cells.forEach((c, i) => {
        const f = c.bold ? bold : font;
        lignes[i].forEach((l, k) => {
          const tx = cols[i].align === "right" ? x + widths[i] - 4 - w(l, size, f) : x + 4;
          text(l, tx, y - 4 - size - k * (size + 3), size, f, c.color ?? INK);
        });
        x += widths[i];
      });
      y -= h;
      page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.4, color: RULE });
    });
  }

  async function qr(url: string): Promise<PDFImage> {
    return pdf.embedPng(await QRCode.toBuffer(url, { type: "png", width: 220, margin: 1 }));
  }

  /** Bandeau de page : logo, titre, numéro, QR. */
  function bandeau(titrePage: string, sousTitre: string, statut: string, image: PDFImage) {
    const top = PAGE_H - M;
    const logoH = 22;
    page.drawImage(logo, { x: LEFT, y: top - logoH, width: (logo.width / logo.height) * logoH, height: logoH });
    text(titrePage, LEFT, top - logoH - 16, 15, bold);
    text(sousTitre, LEFT, top - logoH - 30, 9.5, font, MUTED);
    const qrS = 62;
    page.drawImage(image, { x: RIGHT - qrS, y: top - qrS, width: qrS, height: qrS });
    const sw = w(statut, 8.5, bold) + 14;
    page.drawRectangle({ x: RIGHT - qrS - 10 - sw, y: top - 18, width: sw, height: 16, color: rgb(0.89, 0.918, 0.965) });
    text(statut, RIGHT - qrS - 10 - sw + 7, top - 13, 8.5, bold, BRAND);
    y = top - qrS - 10;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1, color: INK });
    y -= 4;
  }
  function pied() {
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      const s = safe(`Ordre de tracé ${data.numeroOt} - édité le ${data.generatedAt} - page ${i + 1}/${pages.length}`);
      p.drawText(s, { x: LEFT, y: M - 14, size: 7, font, color: MUTED });
    });
  }

  // ---------------------------------------------------------------------
  // Page 1 : récapitulatif de l'ordre
  // ---------------------------------------------------------------------
  const qrOrdre = await qr(data.url);
  if (!data.ficheMatelasSeule) {
    entete = () => {
      text(`Ordre de tracé ${data.numeroOt} (suite)`, LEFT, PAGE_H - M - 10, 9, bold, MUTED);
      y = PAGE_H - M - 20;
    };
    bandeau(
      `Ordre de tracé ${data.numeroOt}`,
      data.regroupee ? `Ordre de coupe regroupé - ${data.designation}` : data.designation,
      data.statutLabel,
      qrOrdre
    );
    grille([
      ["Article / pièces", data.designation],
      ["Modèle", data.modele],
      ["Client", data.client],
      ["Tissu", data.tissu],
      ["Grammage", data.grammage ? `${n(data.grammage)} g/m²` : null],
      ["Laize utile", data.laizeUtileCm ? `${n(data.laizeUtileCm)} cm` : null],
      ["Couleur", data.couleur],
      ["Émis le", data.dateEmission],
      ["Retour souhaité", data.dateRetour],
    ]);
    if (data.contraintes || data.observations) {
      grille(
        [
          ["Contraintes", data.contraintes],
          ["Observations", data.observations],
        ],
        2
      );
    }

    titre(data.regroupee ? "Produits finis du regroupement" : "Produit fini");
    tableau(
      [
        { title: "ODF", width: 15 },
        { title: "Client", width: 17 },
        { title: "Article", width: 22 },
        { title: "Couleur", width: 13 },
        { title: "Qté", width: 7, align: "right" },
        { title: "Par taille", width: 26 },
      ],
      data.articles.map((a) => [
        a.odfAnnule ? { v: `${a.odf ?? "-"} (ANNULÉ)`, color: DANGER, bold: true } : { v: a.odf ?? "-", bold: true },
        a.client ?? "-",
        a.article,
        a.couleur ?? "-",
        a.quantite !== null ? n(a.quantite) : "-",
        a.tailles.map(([t, q]) => `${t} ${q}`).join(" · ") || "-",
      ])
    );
    if (data.articles.some((a) => a.odfAnnule)) {
      place(14);
      y -= 11;
      text("ODF annulé : les pièces coupées pour cet article restent en stock tampon, à réorienter vers un autre ODF.", LEFT, y, 7.5, font, DANGER);
    }
    const avecPieces = data.articles.filter((a) => a.pieces.length > 0);
    if (avecPieces.length > 0) {
      titre("Pièces (semi-finis) et couleurs par article");
      tableau(
        [
          { title: "ODF / article", width: 35 },
          { title: "Pièces et couleur de chacune", width: 65 },
        ],
        avecPieces.map((a) => [
          `${a.odf ?? "-"} · ${a.article}`,
          a.pieces.map((p) => `${p.nom} : ${p.couleur ?? "COULEUR À PRÉCISER"}`).join("\n"),
        ])
      );
    }

    titre("Tracés");
    tableau(
      [
        { title: "Tracé", width: 16 },
        { title: "Statut / forme", width: 14 },
        { title: "Long. × laize", width: 13 },
        { title: "Couches", width: 8, align: "right" },
        { title: "Tissus (couches)", width: 28 },
        { title: "Pièces par couche", width: 21 },
      ],
      data.traces.map((t) => [
        { v: t.reference, bold: true },
        `${t.statut}\n${t.forme}`,
        `${n(t.longueurCm)} × ${n(t.laizeCm)} cm`,
        n(t.couches),
        t.tissus.map((x) => `${x.libelle} : ${n(x.couches)}`).join("\n") || t.tissusPrevus.join("\n") || data.tissu || "-",
        t.piecesParCouche.map((p) => `${p.quantite} ${p.piece} ${p.taille}`).join(", ") || "-",
      ])
    );
  }

  // ---------------------------------------------------------------------
  // Une fiche matelas par tracé
  // ---------------------------------------------------------------------
  for (let i = 0; i < data.traces.length; i += 1) {
    const t = data.traces[i];
    if (i > 0 || !data.ficheMatelasSeule) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
    }
    entete = () => {
      text(`Fiche matelas ${t.reference} (suite)`, LEFT, PAGE_H - M - 10, 9, bold, MUTED);
      y = PAGE_H - M - 20;
    };
    bandeau(`Fiche matelas ${t.reference}`, `Ordre de tracé ${data.numeroOt} - ${data.designation}`, t.statut, await qr(t.url));

    grille(
      [
        ["Forme du tissu", t.forme],
        ["Longueur du matelas", t.longueurCm !== null ? `${n(t.longueurCm)} cm` : null],
        ["Laize", t.laizeCm !== null ? `${n(t.laizeCm)} cm` : null],
        ["Couches au total", t.couches !== null ? n(t.couches) : null],
        ["Tissu", data.tissu ? `${data.tissu}${data.grammage ? ` - ${n(data.grammage)} g/m²` : ""}` : null],
        ["Patron", t.referencePatron],
        ["Tissus prévus", t.tissusPrevus.length > 0 ? t.tissusPrevus.join("\n") : null],
      ],
      3
    );

    if (t.rouleaux.length > 0) {
      titre("Rouleaux prévus");
      tableau(
        [
          { title: "Rouleau", width: 34 },
          { title: "Laize", width: 22, align: "right" },
          { title: "Bain", width: 22 },
          { title: "Poids", width: 22, align: "right" },
        ],
        t.rouleaux.map((r) => [{ v: r.code, bold: true }, r.laizeCm !== null ? `${n(r.laizeCm)} cm` : "-", r.bain ?? "-", r.poidsKg !== null ? `${n(r.poidsKg)} kg` : "-"])
      );
    }

    if (t.tissus.length > 0) {
      titre("Composition du matelas par tissu");
      tableau(
        [
          { title: "Tissu (grammage, couleur, référence)", width: 46 },
          { title: "Couches", width: 12, align: "right" },
          { title: "ODF (couches)", width: 42 },
        ],
        t.tissus.map((x) => [{ v: x.libelle, bold: true }, { v: n(x.couches), bold: true }, x.odfs])
      );
    }

    if (t.couchesParArticle.length > 0) {
      titre("Couches par article");
      tableau(
        [
          { title: "Article", width: 50 },
          { title: "Couleur des pièces", width: 34 },
          { title: "Couches", width: 16, align: "right" },
        ],
        [
          ...t.couchesParArticle.map((c) => [
            c.odfAnnule ? { v: `${c.libelle} (ODF ANNULÉ)`, color: DANGER } : { v: c.libelle },
            c.couleur ?? "-",
            { v: n(c.couches), bold: true },
          ]),
          [{ v: "Total", bold: true }, "", { v: n(t.couches), bold: true }],
        ]
      );
    }

    if (t.piecesParCouche.length > 0) {
      titre("Pièces à obtenir");
      const totalCouches = t.couches ?? 0;
      const parArticle = t.couchesParArticle.length > 0;
      tableau(
        [
          { title: "Pièce", width: parArticle ? 26 : 34 },
          { title: "Taille", width: 12 },
          { title: "Par couche", width: 14, align: "right" },
          ...(parArticle ? [{ title: "Par article", width: 32 }] : []),
          { title: "Total", width: 16, align: "right" },
        ],
        t.piecesParCouche.map((p) => [
          p.piece,
          p.taille,
          n(p.quantite),
          ...(parArticle ? [t.couchesParArticle.map((c) => `${c.libelle.split(" · ")[0]} ${p.quantite * c.couches}`).join(" · ")] : []),
          { v: n(p.quantite * totalCouches), bold: true },
        ])
      );
    }

    // Dessin du tracé (hors échelle), dans la place qui reste.
    let dessin: PDFEmbeddedPage | null = null;
    if (t.dessin) {
      try {
        [dessin] = await pdf.embedPdf(t.dessin, [0]);
      } catch {
        dessin = null;
      }
    }
    if (dessin) {
      // On garde la place de la zone à remplir (environ 200 pt) sous le dessin ;
      // s'il reste trop peu, le dessin part en haut d'une nouvelle page.
      if (y - BAS - 25 - ZONE_SAISIE < 100) nouvellePage();
      titre("Tracé (hors échelle - ne sert pas de gabarit)");
      const hMax = Math.min(y - BAS - ZONE_SAISIE - 10, 300);
      const s = Math.min(CONTENT_W / dessin.width, hMax / dessin.height);
      const dw = dessin.width * s;
      const dh = dessin.height * s;
      y -= 4;
      page.drawPage(dessin, { x: LEFT + (CONTENT_W - dw) / 2, y: y - dh, width: dw, height: dh });
      page.drawRectangle({ x: LEFT, y: y - dh - 2, width: CONTENT_W, height: dh + 4, borderColor: RULE, borderWidth: 0.5 });
      y -= dh + 6;
    }

    // Zone à remplir par le coupeur.
    titre("À remplir à la coupe");
    const lignesSaisie: [string, number][] = [
      ["Rouleaux utilisés (code, bain, poids)", 34],
      ["Couches réellement matelassées (par article si regroupé)", 26],
      ["Longueur réelle / laize réelle (cm)", 20],
      ["Déchets (kg)", 20],
      ["Observations (manques, défauts, pièces abîmées)", 34],
    ];
    for (const [label, h] of lignesSaisie) {
      place(h);
      page.drawRectangle({ x: LEFT, y: y - h, width: CONTENT_W, height: h, borderColor: RULE, borderWidth: 0.6 });
      text(label, LEFT + 5, y - 10, 7.5, font, MUTED);
      y -= h;
    }
    place(30);
    page.drawRectangle({ x: LEFT, y: y - 30, width: CONTENT_W, height: 30, borderColor: RULE, borderWidth: 0.6 });
    ["Coupeur", "Date", "Visa chef de coupe"].forEach((l, k) => {
      const x = LEFT + (k * CONTENT_W) / 3;
      if (k > 0) page.drawLine({ start: { x, y }, end: { x, y: y - 30 }, thickness: 0.6, color: RULE });
      text(l, x + 5, y - 10, 7.5, font, MUTED);
    });
    y -= 30;
  }

  if (data.traces.length === 0 && data.ficheMatelasSeule) {
    bandeau(`Ordre de tracé ${data.numeroOt}`, data.designation, data.statutLabel, qrOrdre);
    text("Aucun tracé à imprimer.", LEFT, y - 14, 10);
  }

  pied();
  return pdf.save();
}
