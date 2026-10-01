import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { computeQuoteTotals } from "@/lib/quote-totals";
import { amountInWordsFr } from "@/lib/number-to-words-fr";
import { QUOTE_STATUS_LABELS, type CompanySettings, type Quote } from "@/lib/types/domain";

/**
 * Devis / facture proforma au format PDF (A4) — mentions attendues sur un
 * document commercial ivoirien : identité légale de l'émetteur (RCCM, NCC,
 * régime d'imposition, capital), identification du client, numéro continu,
 * dates d'émission et de validité, désignation / quantité / PU HT, remise,
 * HT / TVA / TTC, montant en lettres, conditions et mode de règlement,
 * acompte, délai de livraison, coordonnées bancaires, signatures. Le QR
 * code renvoie à la proforma sur la plateforme (client comme équipe).
 *
 * L'émetteur est lu dans `company_settings` (Paramètres > Informations
 * société) au moment de la génération : le PDF reflète donc la fiche société
 * courante, pas un instantané du jour d'émission du devis.
 *
 * Polices standard PDF (WinAnsi) : `safe()` neutralise les caractères hors
 * jeu (espace insécable fine d'Intl, etc.) qui feraient échouer l'encodage.
 */

export interface QuotePdfLine {
  description: string;
  quantity: number;
  unit_price: number;
  /** « Couleur unique : Bleu » / « Col : Rouge · Manches : Blanc » — vide si aucune configuration. */
  colors: string;
}

export interface QuotePdfClient {
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  ncc: string | null;
  rccm: string | null;
  contactName: string | null;
}

export interface QuotePdfData {
  quote: Pick<
    Quote,
    | "reference"
    | "status"
    | "created_at"
    | "valid_until"
    | "date_livraison_prevue"
    | "objet"
    | "reference_client"
    | "remise_pct"
    | "tva_rate"
    | "tva_exoneration_motif"
    | "mode_reglement"
    | "conditions_paiement"
    | "acompte_pct"
    | "delai_livraison"
    | "notes"
  >;
  client: QuotePdfClient;
  issuer: CompanySettings | null;
  lines: QuotePdfLine[];
  logoPng: Uint8Array;
  qrPng: Uint8Array;
  quoteUrl: string;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const CW = PAGE_W - M * 2;
const FOOTER_H = 62; // réservé en bas de chaque page (mentions légales + pagination)

const ink = rgb(0.11, 0.09, 0.09);
const muted = rgb(0.42, 0.4, 0.38);
const line = rgb(0.86, 0.84, 0.81);
const band = rgb(0.95, 0.94, 0.92);
const accent = rgb(0.1, 0.1, 0.1);

/** Remplace ce que Helvetica/WinAnsi ne sait pas encoder. */
function safe(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/[   ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\r\t]/g, " ")
    .replace(/[^\n\x20-\x7e\xa1-\xff€–—•…]/g, "?");
}

function money(n: number): string {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} F CFA`;
}

function dateFr(value: string | null | undefined): string {
  if (!value) return "-";
  return safe(new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value)));
}

function pct(n: number): string {
  return `${Number(n).toString().replace(".", ",")} %`;
}

export async function buildQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const { quote, client, issuer, lines } = data;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Proforma ${quote.reference}`);
  pdf.setProducer("Seritex");
  pdf.setCreationDate(new Date());

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(data.logoPng);
  const qr = await pdf.embedPng(data.qrPng);

  const issuerName = safe(issuer?.raison_sociale || "SERITEX");
  const tvaRate = Number(quote.tva_rate ?? 0);
  const remisePct = Number(quote.remise_pct ?? 0);
  const acomptePct = Number(quote.acompte_pct ?? 0);
  const totals = computeQuoteTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price })),
    remisePct,
    tvaRate,
    acomptePct
  );

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  const pages: PDFPage[] = [page];

  function wrap(text: string, maxWidth: number, size: number, f: PDFFont): string[] {
    const out: string[] = [];
    for (const paragraph of safe(text).split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const attempt = current ? `${current} ${word}` : word;
        if (f.widthOfTextAtSize(attempt, size) > maxWidth && current) {
          out.push(current);
          current = word;
        } else current = attempt;
      }
      out.push(current);
    }
    return out;
  }

  function text(str: string, x: number, yy: number, size: number, f: PDFFont = font, color = ink) {
    page.drawText(safe(str), { x, y: yy, size, font: f, color });
  }

  function textRight(str: string, xRight: number, yy: number, size: number, f: PDFFont = font, color = ink) {
    const s = safe(str);
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });
  }

  function hr(yy: number, color = line) {
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE_W - M, y: yy }, thickness: 0.7, color });
  }

  function ensureSpace(height: number, onNewPage?: () => void) {
    if (y - height < M + FOOTER_H) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      y = PAGE_H - M;
      onNewPage?.();
    }
  }

  // ── En-tête : logo + émetteur à gauche, QR à droite ──────────────────────
  const logoH = 36;
  const logoW = logoH * (logo.width / logo.height);
  page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH });

  const QR = 78;
  page.drawImage(qr, { x: PAGE_W - M - QR, y: y - QR, width: QR, height: QR });
  const qrCaption = "Scanner pour consulter";
  text(qrCaption, PAGE_W - M - QR / 2 - font.widthOfTextAtSize(qrCaption, 6.5) / 2, y - QR - 8, 6.5, font, muted);
  const qrCaption2 = "la proforma en ligne";
  text(qrCaption2, PAGE_W - M - QR / 2 - font.widthOfTextAtSize(qrCaption2, 6.5) / 2, y - QR - 15, 6.5, font, muted);

  let iy = y - logoH - 12;
  text(issuerName, M, iy, 10.5, bold);
  iy -= 12;
  const issuerLines = [
    [issuer?.forme_juridique, issuer?.capital_social != null ? `capital de ${money(issuer.capital_social)}` : null]
      .filter(Boolean)
      .join(" au "),
    [issuer?.adresse, issuer?.boite_postale ? `BP ${issuer.boite_postale}` : null].filter(Boolean).join(", "),
    [issuer?.ville, issuer?.pays].filter(Boolean).join(", "),
    [issuer?.telephone ? `Tél. ${issuer.telephone}` : null, issuer?.email].filter(Boolean).join("  |  "),
    issuer?.site_web ?? "",
  ].filter(Boolean);
  for (const l of issuerLines) {
    text(l, M, iy, 8.5, font, muted);
    iy -= 11;
  }
  y = Math.min(iy, y - QR - 22) - 6;

  // ── Titre + numéro ────────────────────────────────────────────────────────
  hr(y + 4, accent);
  y -= 16;
  text("FACTURE PROFORMA", M, y, 16, bold);
  textRight(`N° ${quote.reference}`, PAGE_W - M, y, 12, bold);
  y -= 8;
  if (quote.status === "refuse" || quote.status === "expire") {
    text(`Statut : ${QUOTE_STATUS_LABELS[quote.status]}`, M, y - 6, 8.5, bold, rgb(0.7, 0.1, 0.1));
  }
  y -= 14;

  // ── Bandeau de dates / références ────────────────────────────────────────
  const metas: [string, string][] = [
    ["Date d'émission", dateFr(quote.created_at)],
    ["Valable jusqu'au", dateFr(quote.valid_until)],
    ["Référence client", quote.reference_client || "-"],
    ["Livraison prévue", quote.date_livraison_prevue ? dateFr(quote.date_livraison_prevue) : "-"],
  ];
  const colW = CW / metas.length;
  page.drawRectangle({ x: M, y: y - 30, width: CW, height: 34, color: band });
  metas.forEach(([label, value], i) => {
    text(label.toUpperCase(), M + 8 + i * colW, y - 8, 6.5, bold, muted);
    const lines1 = wrap(value, colW - 12, 9.5, bold);
    text(lines1[0] ?? "-", M + 8 + i * colW, y - 21, 9.5, bold);
  });
  y -= 46;

  // ── Émetteur / Client ─────────────────────────────────────────────────────
  const boxW = (CW - 14) / 2;
  const issuerBox: string[] = [
    issuer?.rccm ? `RCCM : ${issuer.rccm}` : "",
    issuer?.ncc ? `N° CC : ${issuer.ncc}` : "",
    issuer?.regime_imposition ? `Régime : ${issuer.regime_imposition}` : "",
    issuer?.centre_impots ? `Centre des impôts : ${issuer.centre_impots}` : "",
    issuer?.assujetti_tva === false ? "Non assujetti à la TVA" : "",
  ].filter(Boolean);
  const clientAddress = [client.address, [client.postal_code, client.city].filter(Boolean).join(" "), client.country]
    .filter(Boolean)
    .join(", ");
  const clientBox: string[] = [
    ...wrap(clientAddress, boxW - 16, 8.5, font).filter(Boolean),
    client.contactName ? `À l'attention de : ${client.contactName}` : "",
    client.phone ? `Tél. ${client.phone}` : "",
    client.email ?? "",
    client.ncc ? `N° CC : ${client.ncc}` : "",
    client.rccm ? `RCCM : ${client.rccm}` : "",
  ].filter(Boolean);
  const boxH = 38 + Math.max(issuerBox.length, clientBox.length, 1) * 11 + 4;
  ensureSpace(boxH + 10);
  const drawBox = (x: number, title: string, head: string, rows: string[]) => {
    page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, borderColor: line, borderWidth: 0.8 });
    text(title, x + 8, y - 12, 6.5, bold, muted);
    text(wrap(head, boxW - 16, 10, bold)[0] ?? "", x + 8, y - 25, 10, bold);
    rows.forEach((r, i) => text(r, x + 8, y - 38 - i * 11, 8.5, font, ink));
  };
  drawBox(M, "ÉMETTEUR", issuerName, issuerBox);
  drawBox(M + boxW + 14, "CLIENT", client.name, clientBox);
  y -= boxH + 24;

  if (quote.objet) {
    const objLines = wrap(`Objet : ${quote.objet}`, CW, 10, bold);
    ensureSpace(objLines.length * 13 + 8);
    for (const l of objLines) {
      text(l, M, y, 10, bold);
      y -= 13;
    }
    y -= 6;
  }

  // ── Tableau des articles ──────────────────────────────────────────────────
  const X = { n: M, desc: M + 26, qtyRight: M + CW - 190, puRight: M + CW - 105, total: M + CW };
  const descW = X.qtyRight - 40 - X.desc;
  const drawTableHeader = () => {
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 20, color: accent });
    const h = rgb(1, 1, 1);
    text("N°", X.n + 6, y - 9, 8, bold, h);
    text("DÉSIGNATION", X.desc, y - 9, 8, bold, h);
    textRight("QTÉ", X.qtyRight, y - 9, 8, bold, h);
    textRight("PU HT", X.puRight, y - 9, 8, bold, h);
    textRight("TOTAL HT", X.total - 6, y - 9, 8, bold, h);
    y -= 24;
  };
  ensureSpace(60);
  drawTableHeader();

  lines.forEach((l, i) => {
    const descLines = wrap(l.description, descW, 9, font);
    const colorLines = l.colors ? wrap(l.colors, descW, 7.5, font) : [];
    const rowH = descLines.length * 11.5 + colorLines.length * 10 + 10;
    ensureSpace(rowH, drawTableHeader);
    let ry = y - 9;
    text(String(i + 1), X.n + 6, ry, 9, font, muted);
    for (const d of descLines) {
      text(d, X.desc, ry, 9);
      ry -= 11.5;
    }
    for (const c of colorLines) {
      text(c, X.desc, ry, 7.5, font, muted);
      ry -= 10;
    }
    textRight(String(l.quantity), X.qtyRight, y - 9, 9);
    textRight(money(l.unit_price), X.puRight, y - 9, 9);
    textRight(money(l.quantity * l.unit_price), X.total - 6, y - 9, 9, bold);
    y -= rowH;
    hr(y + 3);
  });
  y -= 10;

  // ── Totaux ────────────────────────────────────────────────────────────────
  const totalRows: { label: string; value: string; strong?: boolean }[] = [{ label: "Total brut HT", value: money(totals.brut) }];
  if (totals.remise > 0) totalRows.push({ label: `Remise ${pct(remisePct)}`, value: `- ${money(totals.remise)}` });
  totalRows.push({ label: "Total HT", value: money(totals.ht) });
  totalRows.push({ label: tvaRate > 0 ? `TVA ${pct(tvaRate)}` : "TVA", value: tvaRate > 0 ? money(totals.tva) : "Exonéré" });
  totalRows.push({ label: "TOTAL TTC", value: money(totals.ttc), strong: true });
  if (totals.acompte > 0) {
    totalRows.push({ label: `Acompte à la commande (${pct(acomptePct)})`, value: money(totals.acompte) });
    totalRows.push({ label: "Reste à payer à la livraison", value: money(totals.reste) });
  }
  ensureSpace(totalRows.length * 16 + 60);
  const tx = M + CW - 250;
  for (const r of totalRows) {
    if (r.strong) {
      page.drawRectangle({ x: tx - 6, y: y - 5, width: 256, height: 18, color: band });
    }
    text(r.label, tx, y, r.strong ? 10 : 9, r.strong ? bold : font, r.strong ? ink : muted);
    textRight(r.value, M + CW - 6, y, r.strong ? 10.5 : 9, bold);
    y -= 16;
  }
  y -= 6;

  // ── Montant en lettres ────────────────────────────────────────────────────
  const words = wrap(
    `Arrêtée la présente proforma à la somme de : ${amountInWordsFr(totals.ttc)}${tvaRate > 0 ? " toutes taxes comprises" : ""}.`,
    CW - 16,
    9,
    bold
  );
  ensureSpace(words.length * 12 + 16);
  page.drawRectangle({ x: M, y: y - words.length * 12 - 4, width: CW, height: words.length * 12 + 10, borderColor: line, borderWidth: 0.8 });
  words.forEach((w, i) => text(w, M + 8, y - 6 - i * 12, 9, bold));
  y -= words.length * 12 + 24;

  // ── Conditions ────────────────────────────────────────────────────────────
  const terms: [string, string][] = [];
  if (quote.mode_reglement) terms.push(["Mode de règlement", quote.mode_reglement]);
  if (quote.conditions_paiement) terms.push(["Conditions de paiement", quote.conditions_paiement]);
  if (quote.delai_livraison) terms.push(["Délai de livraison", quote.delai_livraison]);
  terms.push(["Validité de l'offre", quote.valid_until ? `Jusqu'au ${dateFr(quote.valid_until)}` : "Non précisée"]);
  if (tvaRate === 0 && quote.tva_exoneration_motif) terms.push(["Exonération de TVA", quote.tva_exoneration_motif]);
  const bank = [
    issuer?.banque_nom,
    issuer?.banque_compte ? `Compte ${issuer.banque_compte}` : null,
    issuer?.banque_swift ? `SWIFT ${issuer.banque_swift}` : null,
  ]
    .filter(Boolean)
    .join(" - ");
  if (bank) terms.push(["Coordonnées bancaires", bank]);
  if (issuer?.mobile_money) terms.push(["Mobile money", issuer.mobile_money]);
  if (quote.notes) terms.push(["Remarques", quote.notes]);

  ensureSpace(30);
  text("CONDITIONS", M, y, 7.5, bold, muted);
  y -= 6;
  hr(y);
  y -= 13;
  for (const [label, value] of terms) {
    const valueLines = wrap(value, CW - 130, 8.5, font);
    ensureSpace(valueLines.length * 11 + 4);
    text(label, M, y, 8.5, bold);
    valueLines.forEach((v, i) => text(v, M + 130, y - i * 11, 8.5));
    y -= valueLines.length * 11 + 4;
  }
  if (issuer?.mentions_devis) {
    y -= 4;
    for (const l of wrap(issuer.mentions_devis, CW, 7.5, font)) {
      ensureSpace(10);
      text(l, M, y, 7.5, font, muted);
      y -= 10;
    }
  }

  // ── Signatures ────────────────────────────────────────────────────────────
  const sigH = 78;
  y -= 14;
  ensureSpace(sigH + 6);
  const sigW = (CW - 14) / 2;
  const drawSig = (x: number, title: string, sub: string) => {
    page.drawRectangle({ x, y: y - sigH, width: sigW, height: sigH, borderColor: line, borderWidth: 0.8 });
    text(title, x + 8, y - 13, 8.5, bold);
    text(sub, x + 8, y - 24, 7, font, muted);
  };
  drawSig(M, "Le client - Bon pour accord", "Date, nom, cachet et signature");
  drawSig(
    M + sigW + 14,
    `Pour ${issuerName}`,
    [issuer?.signataire_nom, issuer?.signataire_fonction].filter(Boolean).join(", ") || "Signature et cachet"
  );

  // ── Pied de page de chaque page : mentions légales + pagination ──────────
  const legal = [
    [issuerName, issuer?.forme_juridique, issuer?.capital_social != null ? `au capital de ${money(issuer.capital_social)}` : null]
      .filter(Boolean)
      .join(" "),
    issuer?.rccm ? `RCCM ${issuer.rccm}` : null,
    issuer?.ncc ? `N° CC ${issuer.ncc}` : null,
    issuer?.regime_imposition ? `Régime ${issuer.regime_imposition}` : null,
    issuer?.centre_impots ? `Centre des impôts ${issuer.centre_impots}` : null,
    [issuer?.adresse, issuer?.ville].filter(Boolean).length ? `Siège : ${[issuer?.adresse, issuer?.ville].filter(Boolean).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("  -  ");
  const legalLines = wrap(legal, CW, 7, font).slice(0, 3);
  pages.forEach((p, idx) => {
    page = p;
    hr(M + FOOTER_H - 14);
    legalLines.forEach((l, i) => {
      const w = font.widthOfTextAtSize(safe(l), 7);
      text(l, (PAGE_W - w) / 2, M + FOOTER_H - 25 - i * 9, 7, font, muted);
    });
    text(`${quote.reference}  -  ${data.quoteUrl}`, M, M + 4, 6.5, font, muted);
    textRight(`Page ${idx + 1} / ${pages.length}`, PAGE_W - M, M + 4, 6.5, font, muted);
  });

  return pdf.save();
}
