import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getLogoPngBytes } from "./logo";
import { formatDuree, type ReportValeur, type ReportView } from "@/lib/production-report";
import { PIECE_STATUT_LABELS } from "@/lib/pieces-coupees";

/**
 * Mise en page du rapport de production (migration 0145), imprimable.
 *
 * Même séparation que le bon d'ODF (`odf-pdf.ts`) : la route
 * `api/production/[id]/rapport/pdf` lit le rapport figé et le passe ici ;
 * ce module ne fait que dessiner. Même palette et mêmes marges que le bon
 * d'ODF. Document A4 portrait : en-tête, synthèse, puis un tableau par
 * partie (quantités par taille, travaux par section, tissu et
 * consommables, valeurs pour qui voit les coûts), qui continuent sur la
 * page suivante si besoin.
 */

export interface ProductionReportPdfData {
  reference: string;
  client: string;
  numero: number;
  genereLe: string;
  demandePar: string | null;
  motifDemande: string | null;
  decision: string | null;
  decisionLe: string | null;
  decisionPar: string | null;
  decisionNote: string | null;
  view: ReportView;
  /** Null sans le droit Tarification : la partie Valeurs n'est pas imprimée. */
  valeur: ReportValeur | null;
  tailleLabel: (cle: string) => string;
  formatDateTime: (value: string | null) => string;
  formatMoney: (value: number | null) => string;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M_TOP = 42;
const M_BOTTOM = 44;
const M_SIDE = 42;
const CONTENT_W = PAGE_W - M_SIDE * 2;
const LEFT = M_SIDE;
const BRAND = rgb(0, 0.251, 0.565);
const BRAND_SOFT = rgb(0.89, 0.918, 0.965);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.11, 0.09, 0.09);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.85, 0.83, 0.8);
const ZEBRA = rgb(0.965, 0.96, 0.953);
const DANGER = rgb(0.72, 0.11, 0.11);

/** Polices standard (WinAnsi) : on ramène à Latin-1 tout ce qui vient de la base. */
function safe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/œ/g, "oe")
    .replace(/[   ]/g, " ")
    .replace(/[^ -ÿ\n]/g, "?");
}

const kg = (v: number | null) => (v === null ? "-" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`);
const signe = (v: number) => (v > 0 ? `+${v}` : String(v));

type Col = { label: string; width: number; align?: "left" | "right" };

export async function buildProductionReportPdf(d: ProductionReportPdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Rapport de production ${safe(d.reference)} n°${d.numero}`);
  pdfDoc.setProducer("Seritex");
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdfDoc.embedPng(await getLogoPngBytes());

  let page: PDFPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M_TOP;

  const text = (value: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(value), { x, y: yy, size, font: f, color });
  const width = (value: string, size: number, f: PDFFont = font) => f.widthOfTextAtSize(safe(value), size);
  const fit = (value: string, max: number, size: number, f: PDFFont = font) => {
    // Texte trop long pour sa colonne : tronqué, terminé par un point.
    let s = safe(value);
    while (s.length > 1 && f.widthOfTextAtSize(s, size) > max) s = `${s.slice(0, -2)}.`;
    return s;
  };
  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M_TOP;
    text(`${d.reference} - rapport de production n°${d.numero} (suite)`, LEFT, y - 8, 8, font, MUTED);
    y -= 22;
  }
  const ensure = (h: number) => {
    if (y - h < M_BOTTOM) newPage();
  };

  // 1. Bandeau
  const logoH = 26;
  page.drawImage(logo, { x: LEFT, y: y - logoH, width: (logo.width / logo.height) * logoH, height: logoH });
  const titre = "RAPPORT DE PRODUCTION";
  text(titre, PAGE_W - M_SIDE - width(titre, 14, bold), y - 12, 14, bold, BRAND);
  const sous = `${d.reference} · n°${d.numero}`;
  text(sous, PAGE_W - M_SIDE - width(sous, 10, bold), y - 26, 10, bold);
  y -= logoH + 14;
  page.drawLine({ start: { x: LEFT, y }, end: { x: PAGE_W - M_SIDE, y }, thickness: 1, color: BRAND });
  y -= 16;

  // 2. Cartouche
  const lignes: [string, string][] = [
    ["Client", d.client],
    ["Généré le", `${d.formatDateTime(d.genereLe)}${d.demandePar ? ` - demande de clôture de ${d.demandePar}` : ""}`],
    [
      "Décision",
      d.decision ? `${d.decision}${d.decisionLe ? ` le ${d.formatDateTime(d.decisionLe)}` : ""}${d.decisionPar ? ` par ${d.decisionPar}` : ""}` : "En attente de la direction",
    ],
  ];
  if (d.decisionNote) lignes.push(["Note", d.decisionNote]);
  if (d.motifDemande) lignes.push(["Motif de la demande", d.motifDemande]);
  for (const [l, v] of lignes) {
    text(l, LEFT, y, 8, bold, MUTED);
    text(fit(v, CONTENT_W - 110, 9.5), LEFT + 110, y, 9.5);
    y -= 14;
  }
  y -= 6;

  // 3. Synthèse
  const t = d.view.totaux;
  const stats: [string, string, boolean][] = [
    ["Demandé", String(t.demande), false],
    ["Sorti (1er + 2e)", String(t.sorties), false],
    ["Manquants", String(t.manquants), t.manquants > 0],
    ["En plus", String(t.en_plus), false],
    ["2e choix", String(t.deuxieme_choix), false],
    ["Déchets (pièces)", String(t.dechets), false],
    ["Tissu consommé", kg(d.view.tissu.kgNet || null), false],
    ["Déchets de tissu", kg(d.view.tissu.kgDechets || null), false],
  ];
  const cellW = CONTENT_W / 4;
  page.drawRectangle({ x: LEFT, y: y - 62, width: CONTENT_W, height: 66, color: BRAND_SOFT });
  stats.forEach(([l, v, alerte], i) => {
    const x = LEFT + 8 + (i % 4) * cellW;
    const yy = y - 12 - Math.floor(i / 4) * 32;
    text(l, x, yy, 7, font, MUTED);
    text(v, x, yy - 13, 11, bold, alerte ? DANGER : INK);
  });
  y -= 80;

  function heading(title: string, note?: string) {
    ensure(46);
    text(title, LEFT, y, 11, bold, BRAND);
    y -= 12;
    if (note) {
      text(fit(note, CONTENT_W, 7.5), LEFT, y, 7.5, font, MUTED);
      y -= 11;
    }
    y -= 2;
  }

  function table(cols: Col[], rows: { cells: string[]; strong?: boolean; danger?: number[] }[]) {
    const scale = CONTENT_W / cols.reduce((s, c) => s + c.width, 0);
    const ws = cols.map((c) => c.width * scale);
    const rowH = 14;
    const drawHead = () => {
      page.drawRectangle({ x: LEFT, y: y - rowH + 4, width: CONTENT_W, height: rowH, color: BRAND });
      let x = LEFT;
      cols.forEach((c, i) => {
        const label = fit(c.label, ws[i] - 6, 7.5, bold);
        text(label, c.align === "right" ? x + ws[i] - 3 - width(label, 7.5, bold) : x + 3, y - 6, 7.5, bold, WHITE);
        x += ws[i];
      });
      y -= rowH;
    };
    ensure(rowH * 2);
    drawHead();
    rows.forEach((r, ri) => {
      if (y - rowH < M_BOTTOM) {
        newPage();
        drawHead();
      }
      if (ri % 2 === 1) page.drawRectangle({ x: LEFT, y: y - rowH + 4, width: CONTENT_W, height: rowH, color: ZEBRA });
      let x = LEFT;
      r.cells.forEach((v, i) => {
        const f = r.strong ? bold : font;
        const s = fit(v, ws[i] - 6, 8, f);
        const color = r.danger?.includes(i) ? DANGER : INK;
        text(s, cols[i].align === "right" ? x + ws[i] - 3 - width(s, 8, f) : x + 3, y - 6, 8, f, color);
        x += ws[i];
      });
      y -= rowH;
    });
    page.drawLine({ start: { x: LEFT, y: y + 4 }, end: { x: PAGE_W - M_SIDE, y: y + 4 }, thickness: 0.5, color: RULE });
    y -= 12;
  }

  // 4. Quantités par article et par taille
  heading("Quantités par article et par taille", "Écart = 1er + 2e choix - demandé : négatif = manquant, positif = pièces en plus.");
  const R = "right" as const;
  for (const l of d.view.lignes) {
    ensure(40);
    text(fit(l.description, CONTENT_W, 9), LEFT, y, 9, bold);
    y -= 12;
    table(
      [
        { label: "Taille", width: 70 },
        { label: "Demandé", width: 50, align: R },
        { label: "1er choix", width: 50, align: R },
        { label: "2e choix", width: 50, align: R },
        { label: "Écart", width: 45, align: R },
        { label: "Surplus", width: 45, align: R },
        { label: "Déchets", width: 45, align: R },
        { label: "En cours", width: 45, align: R },
      ],
      [
        ...l.tailles.map((s) => ({
          cells: [d.tailleLabel(s.taille), String(s.demande), String(s.premier_choix), String(s.deuxieme_choix), signe(s.ecart), s.surplus ? `+${s.surplus}` : "-", String(s.dechets), String(s.en_cours)],
          danger: s.ecart < 0 ? [4] : [],
        })),
        {
          cells: ["Total", String(l.totaux.demande), String(l.totaux.premier_choix), String(l.totaux.deuxieme_choix), signe(l.totaux.ecart), l.totaux.surplus ? `+${l.totaux.surplus}` : "-", String(l.totaux.dechets), String(l.totaux.en_cours)],
          strong: true,
        },
      ]
    );
  }

  // 5. Travaux par section
  heading("Travaux par section", "Durée écoulée = de la première à la dernière déclaration de la section (pas des heures travaillées).");
  table(
    [
      { label: "Étape · section", width: 100 },
      { label: "Prévu", width: 34, align: R },
      { label: "Fait", width: 34, align: R },
      { label: "Bonnes", width: 38, align: R },
      { label: "1er / 2e", width: 44, align: R },
      { label: "Déchets", width: 40, align: R },
      { label: "Début -> fin", width: 150 },
      { label: "Durée", width: 42, align: R },
    ],
    d.view.sections.map((s) => ({
      cells: [
        `${s.etape ? `${s.etape} · ` : ""}${s.section}${s.ligne ? ` (${s.ligne})` : ""}`,
        String(s.prevu),
        String(s.fait),
        s.bonnes ? String(s.bonnes) : "-",
        s.premier_choix || s.deuxieme_choix ? `${s.premier_choix} / ${s.deuxieme_choix}` : "-",
        s.dechets ? String(s.dechets) : "-",
        s.premiere_declaration ? `${d.formatDateTime(s.premiere_declaration)} -> ${d.formatDateTime(s.derniere_declaration)}` : "aucune déclaration",
        formatDuree(s.duree_ecoulee_min),
      ],
    }))
  );

  // 6. Tissu, déchets, consommables
  heading("Tissu, déchets et consommables");
  const tissu = d.view.tissu;
  table(
    [
      { label: "Tissu reçu", width: 1, align: R },
      { label: "Retour stock", width: 1, align: R },
      { label: "Consommé (net)", width: 1, align: R },
      { label: "Par pièce sortie", width: 1, align: R },
      { label: "Déchets (sacs)", width: 1, align: R },
      { label: "Matelas clôturés", width: 1, align: R },
    ],
    [
      {
        cells: [
          kg(tissu.kgReception),
          kg(tissu.kgRetour),
          kg(tissu.kgNet),
          tissu.kgParPiece === null ? "-" : `${(tissu.kgParPiece * 1000).toFixed(0)} g`,
          kg(tissu.kgDechets),
          String(tissu.matelasClotures),
        ],
      },
    ]
  );
  if (d.view.consommables.length > 0) {
    table(
      [
        { label: "Consommable", width: 180 },
        { label: "Théorique", width: 60, align: R },
        { label: "Réel", width: 60, align: R },
        { label: "Écart", width: 45, align: R },
        { label: "Motif", width: 140 },
      ],
      d.view.consommables.map((k) => ({
        cells: [
          `${k.code} ${k.designation}`,
          `${k.theorique} ${k.unite}`,
          k.reel === null ? "-" : `${k.reel} ${k.unite}`,
          k.ecart === null || k.ecart === 0 ? "-" : signe(k.ecart),
          k.motif ?? "",
        ],
      }))
    );
  }

  // 7. Semi-finis (0146) : coupé au tracé face à l'attendu par la nomenclature.
  if (d.view.semiFinis.length > 0) {
    heading("Semi-finis", "Coupé = pièces reconnues sur le tracé × couches réelles ; attendu = t-shirts obtenus × nomenclature.");
    table(
      [
        { label: "Pièce", width: 260 },
        { label: "Coupé", width: 70, align: R },
        { label: "Attendu", width: 70, align: R },
        { label: "Écart", width: 70, align: R },
      ],
      d.view.semiFinis.map((s) => ({
        cells: [
          `${s.code ? `${s.code} ` : ""}${s.piece}${s.statut !== "semi_fini" ? ` (${PIECE_STATUT_LABELS[s.statut].toLowerCase()})` : ""}`,
          String(s.coupe),
          s.attendu === null ? "-" : String(s.attendu),
          s.ecart === null ? "-" : signe(s.ecart),
        ],
        danger: s.ecart !== null && s.ecart < 0 ? [3] : [],
      }))
    );
  }

  // 8. Valeurs (droit Tarification)
  const v = d.valeur;
  if (v) {
    heading(
      "Valeurs",
      `Réservé au droit Tarification. Prix du tissu figé à la demande de clôture${v.prixKgSource === "odf" ? " (saisi pour l'ODF)" : v.prixKgSource === "article" ? " (fiche article du tissu)" : ""}.`
    );
    const rows: { cells: string[]; strong?: boolean }[] = [
      { cells: ["Prix du tissu au kg", d.formatMoney(v.prixKg)] },
      { cells: ["Tissu consommé", d.formatMoney(v.valeurTissu)] },
      { cells: ["Tissu par pièce sortie", d.formatMoney(v.tissuParPiece)] },
      { cells: ["Déchets de tissu", d.formatMoney(v.valeurDechets)] },
    ];
    const pr = v.prixRevient;
    if (pr?.reel) {
      rows.push(
        { cells: ["Prix de revient théorique (devis)", d.formatMoney(pr.theorique.prixRevient)] },
        { cells: ["Prix de revient réel (total)", d.formatMoney(pr.reel.prixRevient)], strong: true },
        { cells: ["Prix de revient réel par pièce", d.formatMoney(pr.quantite ? pr.reel.prixRevient / pr.quantite : null)], strong: true },
        { cells: ["Écart réel - théorique", pr.ecart === null ? "-" : `${d.formatMoney(pr.ecart)}${pr.ecartPct !== null ? ` (${pr.ecartPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)` : ""}`] }
      );
    }
    table([{ label: "Poste", width: 300 }, { label: "Valeur", width: 200, align: R }], rows);
    for (const w of v.warnings) {
      ensure(12);
      text(fit(`! ${w}`, CONTENT_W, 7.5), LEFT, y, 7.5, font, MUTED);
      y -= 11;
    }
  }

  // Pied de page : numérotation.
  const pages = pdfDoc.getPages();
  pages.forEach((p, i) => {
    const label = safe(`${d.reference} - rapport n°${d.numero} - page ${i + 1}/${pages.length}`);
    p.drawText(label, { x: PAGE_W - M_SIDE - font.widthOfTextAtSize(label, 7), y: 22, size: 7, font, color: MUTED });
  });

  return pdfDoc.save();
}
