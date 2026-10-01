import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { computeQuoteTotals, lineNet } from "@/lib/quote-totals";
import { BASE_CURRENCY, formatMoney } from "@/lib/currency";
import { delaiLabel } from "@/lib/delivery";
import type { DocumentSeal } from "@/lib/signatures";
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
  remise_pct: number;
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

/** Commercial attitré à l'offre (demande, à défaut créateur du devis). */
export interface QuotePdfRepresentative {
  name: string;
  email: string | null;
}

/**
 * Validation du devis (status_history « accepte ») : par le contact du client
 * depuis le portail (`client`) ou enregistrée pour lui par l'équipe (`staff`).
 */
export interface QuotePdfAcceptance {
  name: string;
  by: "client" | "staff";
  at: string;
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
    | "devise"
    | "taux_change"
    | "delai_valeur"
    | "delai_unite"
    | "delai_depart"
    | "notes"
  >;
  client: QuotePdfClient;
  representative: QuotePdfRepresentative | null;
  acceptance: QuotePdfAcceptance | null;
  /** Signature de l'auteur du devis + cachet (migration 0062) ; null → case vide à signer à la main. */
  seal: DocumentSeal | null;
  issuer: CompanySettings | null;
  lines: QuotePdfLine[];
  logoPng: Uint8Array;
  qrPng: Uint8Array;
  quoteUrl: string;
}

/** Marge basse du pied de page : plus petite que M pour le descendre vers le bord. */
const FOOT_BOTTOM = 18;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const CW = PAGE_W - M * 2;

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

/** Montant en F CFA (capital social de l'émetteur, équivalent d'un devis en devise). */
function fcfa(n: number): string {
  return safe(formatMoney(n, BASE_CURRENCY));
}

function dateFr(value: string | null | undefined): string {
  if (!value) return "-";
  return safe(new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value)));
}

function pct(n: number): string {
  return `${Number(n).toString().replace(".", ",")} %`;
}

export async function buildQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const { quote, client, issuer, lines, representative, acceptance, seal } = data;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Proforma ${quote.reference}`);
  pdf.setProducer("Seritex");
  pdf.setCreationDate(new Date());

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(data.logoPng);
  const qr = await pdf.embedPng(data.qrPng);

  const issuerName = safe(issuer?.raison_sociale || "SERITEX");
  const devise = quote.devise ?? BASE_CURRENCY;
  const isBase = devise === BASE_CURRENCY;
  const tauxChange = Number(quote.taux_change ?? 1);
  /** Montant dans la devise du devis. */
  const money = (n: number) => safe(formatMoney(n, devise));
  const tvaRate = Number(quote.tva_rate ?? 0);
  const remisePct = Number(quote.remise_pct ?? 0);
  const acomptePct = Number(quote.acompte_pct ?? 0);
  const totals = computeQuoteTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price, remise_pct: l.remise_pct })),
    remisePct,
    tvaRate,
    acomptePct,
    devise
  );
  const hasLineDiscount = lines.some((l) => l.remise_pct > 0);

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

  // ── Pied de page (calculé d'avance : sa hauteur borne le contenu de chaque page) ──
  // Mentions de pied de proforma en gras (Paramètres > Informations société),
  // puis les coordonnées et identifiants légaux de l'émetteur sur une ligne continue.
  const footerMentions = issuer?.mentions_devis ? wrap(issuer.mentions_devis, CW, 7.5, bold) : [];
  // Coupure entre blocs d'information (jamais au milieu d'un montant ou d'un numéro).
  const footerSegments = [
    [issuer?.adresse, issuer?.boite_postale, issuer?.ville, issuer?.pays].filter(Boolean).join(", "),
    [issuer?.telephone, issuer?.email].filter(Boolean).join(" - "),
    issuer?.site_web,
    issuer?.forme_juridique || issuer?.capital_social != null
      ? `${issuer?.forme_juridique ?? "Capital"} ${issuer?.capital_social != null ? `au capital de ${fcfa(issuer.capital_social)}` : ""}`.trim()
      : null,
    issuer?.rccm ? `RCCM ${issuer.rccm}` : null,
    issuer?.ncc ? `N° compte contribuable (NCC) ${issuer.ncc}` : null,
    issuer?.banque_nom ? `Banque ${issuer.banque_nom}` : null,
    issuer?.banque_compte ? `RIB / IBAN ${issuer.banque_compte}` : null,
  ]
    .filter((v): v is string => !!v)
    .map(safe);
  const footerCoords: string[] = [];
  for (const seg of footerSegments) {
    const last = footerCoords[footerCoords.length - 1];
    const joined = last !== undefined ? `${last}  -  ${seg}` : seg;
    if (last !== undefined && font.widthOfTextAtSize(joined, 7) > CW) footerCoords.push(seg);
    else if (last !== undefined) footerCoords[footerCoords.length - 1] = joined;
    else footerCoords.push(seg);
  }
  const mentionsH = footerMentions.length ? footerMentions.length * 10 + 4 : 0;
  const footerH = 12 + mentionsH + footerCoords.length * 9 + 6;

  function ensureSpace(height: number, onNewPage?: () => void) {
    if (y - height < FOOT_BOTTOM + footerH + 8) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      y = PAGE_H - M;
      onNewPage?.();
    }
  }

  // ── En-tête : le logo seul à gauche, QR à droite (l'identité de l'émetteur est en pied de page) ──
  const logoH = 52;
  const logoW = logoH * (logo.width / logo.height);
  page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH });

  const QR = 78;
  page.drawImage(qr, { x: PAGE_W - M - QR, y: y - QR, width: QR, height: QR });
  const qrCaption = "Scanner pour consulter";
  text(qrCaption, PAGE_W - M - QR / 2 - font.widthOfTextAtSize(qrCaption, 6.5) / 2, y - QR - 8, 6.5, font, muted);
  const qrCaption2 = "la proforma en ligne";
  text(qrCaption2, PAGE_W - M - QR / 2 - font.widthOfTextAtSize(qrCaption2, 6.5) / 2, y - QR - 15, 6.5, font, muted);
  y -= QR + 26;

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
    ["Devise", isBase ? "Franc CFA (XOF)" : devise],
  ];
  const colW = CW / metas.length;
  page.drawRectangle({ x: M, y: y - 30, width: CW, height: 34, color: band });
  metas.forEach(([label, value], i) => {
    text(label.toUpperCase(), M + 8 + i * colW, y - 8, 6.5, bold, muted);
    const lines1 = wrap(value, colW - 12, 9.5, bold);
    text(lines1[0] ?? "-", M + 8 + i * colW, y - 21, 9.5, bold);
  });
  y -= 46;

  // ── Client (identification + validation) / représentant Seritex ─────────────
  const clientW = Math.round(CW * 0.6);
  const repW = CW - clientW - 14;
  const clientAddress = [client.address, [client.postal_code, client.city].filter(Boolean).join(" "), client.country]
    .filter(Boolean)
    .join(", ");
  const clientRows: { t: string; strong?: boolean }[] = [
    ...wrap(clientAddress, clientW - 16, 8.5, font).filter(Boolean).map((t) => ({ t })),
    ...(client.contactName ? [{ t: `À l'attention de : ${client.contactName}` }] : []),
    ...(client.phone ? [{ t: `Tél. ${client.phone}` }] : []),
    ...(client.email ? [{ t: client.email }] : []),
    ...(client.ncc ? [{ t: `N° CC : ${client.ncc}` }] : []),
    ...(client.rccm ? [{ t: `RCCM : ${client.rccm}` }] : []),
  ];
  const clientValidation =
    acceptance?.by === "client"
      ? `Validé en ligne par ${acceptance.name}, le ${dateFr(acceptance.at)}`
      : acceptance
        ? `Validé le ${dateFr(acceptance.at)} (enregistré par ${acceptance.name})`
        : "Validation du client : en attente";
  const clientValidationLines = wrap(clientValidation, clientW - 16, 8, bold);

  const repRows: string[] = [
    ...(representative?.email ? wrap(representative.email, repW - 16, 8.5, font) : []),
    `Offre établie le ${dateFr(quote.created_at)}`,
    ...(acceptance?.by === "staff" ? wrap(`Acceptation saisie par ${acceptance.name}, le ${dateFr(acceptance.at)}`, repW - 16, 8, bold) : []),
  ];

  const clientH = 38 + clientRows.length * 11 + 8 + clientValidationLines.length * 10 + 6;
  const repH = 38 + repRows.length * 11 + 6;
  const boxH = Math.max(clientH, repH);
  ensureSpace(boxH + 10);

  const frame = (x: number, w: number, title: string, head: string) => {
    page.drawRectangle({ x, y: y - boxH, width: w, height: boxH, borderColor: line, borderWidth: 0.8 });
    text(title, x + 8, y - 12, 6.5, bold, muted);
    text(wrap(head, w - 16, 10, bold)[0] ?? "", x + 8, y - 25, 10, bold);
  };
  frame(M, clientW, "CLIENT", client.name);
  clientRows.forEach((r, i) => text(r.t, M + 8, y - 38 - i * 11, 8.5, font, ink));
  const vy = y - 38 - clientRows.length * 11 - 2;
  page.drawLine({ start: { x: M + 8, y: vy + 6 }, end: { x: M + clientW - 8, y: vy + 6 }, thickness: 0.5, color: line });
  clientValidationLines.forEach((l, i) => text(l, M + 8, vy - 4 - i * 10, 8, bold, acceptance ? ink : muted));

  frame(M + clientW + 14, repW, `REPRÉSENTANT ${issuerName.toUpperCase()}`, representative?.name ?? "Non renseigné");
  repRows.forEach((r, i) => text(r, M + clientW + 14 + 8, y - 38 - i * 11, 8.5, font, ink));
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
  const X = {
    n: M,
    desc: M + 26,
    qtyRight: M + CW - (hasLineDiscount ? 250 : 190),
    remRight: M + CW - 190,
    puRight: M + CW - 105,
    total: M + CW,
  };
  const descW = X.qtyRight - 40 - X.desc;
  const drawTableHeader = () => {
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 20, color: accent });
    const h = rgb(1, 1, 1);
    text("N°", X.n + 6, y - 9, 8, bold, h);
    text("DÉSIGNATION", X.desc, y - 9, 8, bold, h);
    textRight("QTÉ", X.qtyRight, y - 9, 8, bold, h);
    if (hasLineDiscount) textRight("REMISE", X.remRight, y - 9, 8, bold, h);
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
    if (hasLineDiscount) textRight(l.remise_pct > 0 ? pct(l.remise_pct) : "-", X.remRight, y - 9, 9, font, l.remise_pct > 0 ? ink : muted);
    textRight(money(l.unit_price), X.puRight, y - 9, 9);
    textRight(money(lineNet(l, devise)), X.total - 6, y - 9, 9, bold);
    y -= rowH;
    hr(y + 3);
  });
  y -= 10;

  // ── Totaux ────────────────────────────────────────────────────────────────
  const totalRows: { label: string; value: string; strong?: boolean }[] = [{ label: "Total brut HT", value: money(totals.brut) }];
  if (totals.remiseLignes > 0) totalRows.push({ label: "Remises de lignes", value: `- ${money(totals.remiseLignes)}` });
  if (totals.remise > 0) totalRows.push({ label: `Remise globale ${pct(remisePct)}`, value: `- ${money(totals.remise)}` });
  totalRows.push({ label: "Total HT", value: money(totals.ht) });
  totalRows.push({ label: tvaRate > 0 ? `TVA ${pct(tvaRate)}` : "TVA", value: tvaRate > 0 ? money(totals.tva) : "Exonéré" });
  totalRows.push({ label: "TOTAL TTC", value: money(totals.ttc), strong: true });
  if (totals.acompte > 0) {
    totalRows.push({ label: `Acompte à la commande (${pct(acomptePct)})`, value: money(totals.acompte) });
    totalRows.push({ label: "Reste à payer à la livraison", value: money(totals.reste) });
  }
  if (!isBase) {
    totalRows.push({ label: `Équivalent F CFA (1 ${devise} = ${String(tauxChange).replace(".", ",")} F CFA)`, value: fcfa(totals.ttc * tauxChange) });
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
    `Arrêtée la présente proforma à la somme de : ${amountInWordsFr(totals.ttc, devise)}${tvaRate > 0 ? " toutes taxes comprises" : ""}.`,
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
  const livraison = quote.date_livraison_prevue
    ? `Le ${dateFr(quote.date_livraison_prevue)}`
    : delaiLabel(quote.delai_valeur, quote.delai_unite, quote.delai_depart);
  if (livraison) terms.push(["Livraison", livraison]);
  if (!isBase) terms.push(["Devise et taux", `${devise} - 1 ${devise} = ${String(tauxChange).replace(".", ",")} F CFA (taux figé à l'émission)`]);
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

  ensureSpace(60); // titre + au moins une ligne : pas de titre orphelin en bas de page
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

  // ── Signatures ────────────────────────────────────────────────────────────
  const sigH = 100;
  y -= 14;
  ensureSpace(sigH + 6);
  const sigW = (CW - 14) / 2;
  const drawSig = (x: number, title: string, sub: string) => {
    page.drawRectangle({ x, y: y - sigH, width: sigW, height: sigH, borderColor: line, borderWidth: 0.8 });
    text(title, x + 8, y - 13, 8.5, bold);
    text(sub, x + 8, y - 24, 7, font, muted);
  };
  drawSig(M, "Le client - Bon pour accord", "Date, nom, cachet et signature");

  const sx = M + sigW + 14;
  if (seal) {
    // Signature de l'auteur du devis + cachet de la société. Le cachet passe
    // dessous, la signature par-dessus (encre sur tampon), comme sur papier.
    drawSig(sx, `Pour ${issuerName}`, "Établi et signé par");
    if (seal.stampPng) {
      const stamp = await pdf.embedPng(seal.stampPng);
      const st = 70;
      page.drawImage(stamp, { x: sx + sigW - st - 14, y: y - sigH + 14, width: st, height: st, opacity: 0.92 });
    }
    const sigImg = await pdf.embedPng(seal.signaturePng);
    const scale = Math.min((sigW * 0.55) / sigImg.width, 42 / sigImg.height);
    page.drawImage(sigImg, { x: sx + 14, y: y - sigH + 30, width: sigImg.width * scale, height: sigImg.height * scale });
    text(seal.name, sx + 8, y - sigH + 17, 8, bold);
    if (seal.fonction) text(seal.fonction, sx + 8, y - sigH + 8, 7, font, muted);
  } else {
    drawSig(sx, `Pour ${issuerName}`, [issuer?.signataire_nom, issuer?.signataire_fonction].filter(Boolean).join(", ") || "Signature et cachet");
  }

  // ── Pied de page de chaque page : mentions, coordonnées, pagination ──────
  pages.forEach((p) => {
    page = p;
    const hrY = FOOT_BOTTOM + footerH - 6;
    hr(hrY);
    let fy = hrY - 11;
    for (const l of footerMentions) {
      text(l, (PAGE_W - bold.widthOfTextAtSize(safe(l), 7.5)) / 2, fy, 7.5, bold);
      fy -= 10;
    }
    if (footerMentions.length) fy -= 4;
    for (const l of footerCoords) {
      text(l, (PAGE_W - font.widthOfTextAtSize(safe(l), 7)) / 2, fy, 7, font, muted);
      fy -= 9;
    }
  });

  return pdf.save();
}
