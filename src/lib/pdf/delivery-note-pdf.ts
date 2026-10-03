import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { BASE_CURRENCY, formatMoney } from "@/lib/currency";
import type { DocumentSeal } from "@/lib/signatures";
import type { CompanySettings } from "@/lib/types/domain";
import { REGLEMENT_LABELS, type ReglementMention } from "@/lib/delivery/status";

/**
 * Bon de livraison Seritex (LIV-1, L2 : le BL Seritex devient le document
 * officiel). Construit sur le socle de la proforma : identité de la société
 * en pied de page, logo, QR code, cachet. Contient les articles et tailles,
 * les quantités, les colis, le lieu et le contact sur place, la date promise,
 * la mention de règlement (et le montant à encaisser, L3), un cadre de
 * décharge (nom, date, signature et cachet du client — L7 : décharge
 * manuscrite), et « Enlèvement par le client » en cas de retrait (L5).
 * Imprimé en deux exemplaires : client et Seritex.
 */

export interface DeliveryNoteLine {
  designation: string;
  /** Tailles dans l'ordre du référentiel : « M » → 20. */
  tailles: { libelle: string; quantite: number }[];
}

export interface DeliveryNoteData {
  reference: string;
  statut: string;
  mode: "livraison" | "retrait";
  editeLe: string;
  datePromise: string | null;
  datePlanifiee: string | null;
  odfReferences: string[];
  client: { name: string; phone: string | null; email: string | null };
  lieu: {
    libelle: string | null;
    zone: string | null;
    quartier: string | null;
    repere: string | null;
    contactNom: string | null;
    contactTel: string | null;
    horaires: string | null;
    consignes: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  reglement: { mention: ReglementMention | null; montant: number | null; texte: string | null };
  colis: { numero: number; poidsKg: number | null; contenu: string | null; codeQr: string | null }[];
  lines: DeliveryNoteLine[];
  livreur: string | null;
  issuer: CompanySettings | null;
  seal: DocumentSeal | null;
  logoPng: Uint8Array;
  qrPng: Uint8Array;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const CW = PAGE_W - M * 2;
const FOOT_BOTTOM = 18;

const ink = rgb(0.11, 0.09, 0.09);
const muted = rgb(0.42, 0.4, 0.38);
const line = rgb(0.86, 0.84, 0.81);
const band = rgb(0.95, 0.94, 0.92);
const accent = rgb(0.1, 0.1, 0.1);
const alert = rgb(0.7, 0.1, 0.1);

export function safe(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/[   ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[\r\t]/g, " ")
    .replace(/[^\n\x20-\x7e\xa1-\xff€–—•…]/g, "?");
}

function dateFr(value: string | null | undefined): string {
  if (!value) return "-";
  return safe(new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value)));
}

export async function buildDeliveryNotePdf(data: DeliveryNoteData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bon de livraison ${data.reference}`);
  pdf.setProducer("Seritex");
  pdf.setCreationDate(new Date());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(data.logoPng);
  const qr = await pdf.embedPng(data.qrPng);
  const stamp = data.seal?.stampPng ? await pdf.embedPng(data.seal.stampPng) : null;
  const signature = data.seal ? await pdf.embedPng(data.seal.signaturePng) : null;

  for (const exemplaire of ["Exemplaire client", `Exemplaire ${data.issuer?.raison_sociale || "Seritex"}`]) {
    drawCopy(pdf, data, exemplaire, { font, bold, logo, qr, stamp, signature });
  }
  return pdf.save();
}

function drawCopy(
  pdf: PDFDocument,
  data: DeliveryNoteData,
  exemplaire: string,
  assets: { font: PDFFont; bold: PDFFont; logo: PDFImage; qr: PDFImage; stamp: PDFImage | null; signature: PDFImage | null }
) {
  const { font, bold, logo, qr } = assets;
  const issuerName = safe(data.issuer?.raison_sociale || "SERITEX");
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  const pages: PDFPage[] = [page];
  let y = PAGE_H - M;

  const wrap = (text: string, maxWidth: number, size: number, f: PDFFont): string[] => {
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
  };
  const text = (str: string, x: number, yy: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(safe(str), { x, y: yy, size, font: f, color });
  const textRight = (str: string, xr: number, yy: number, size: number, f: PDFFont = font, color = ink) => {
    const s = safe(str);
    page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });
  };
  const hr = (yy: number, color = line) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE_W - M, y: yy }, thickness: 0.7, color });

  const issuer = data.issuer;
  const footer = [
    [issuer?.adresse, issuer?.boite_postale, issuer?.ville, issuer?.pays].filter(Boolean).join(", "),
    [issuer?.telephone, issuer?.email].filter(Boolean).join(" - "),
    issuer?.rccm ? `RCCM ${issuer.rccm}` : null,
    issuer?.ncc ? `NCC ${issuer.ncc}` : null,
  ]
    .filter((v): v is string => !!v)
    .join("  -  ");
  const footerLines = wrap(footer, CW, 7, font);
  const footerH = footerLines.length * 9 + 14;

  const ensureSpace = (h: number) => {
    if (y - h < FOOT_BOTTOM + footerH + 8) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      y = PAGE_H - M;
      text(`BON DE LIVRAISON N° ${data.reference} (suite) — ${exemplaire}`, M, y - 10, 9, bold);
      y -= 28;
    }
  };

  // ── En-tête ──────────────────────────────────────────────────────────────
  const logoH = 50;
  page.drawImage(logo, { x: M, y: y - logoH, width: logoH * (logo.width / logo.height), height: logoH });
  const QR = 70;
  page.drawImage(qr, { x: PAGE_W - M - QR, y: y - QR, width: QR, height: QR });
  textRight(exemplaire, PAGE_W - M - QR - 10, y - 10, 8, bold, muted);
  y -= QR + 14;
  hr(y + 4, accent);
  y -= 16;
  text("BON DE LIVRAISON", M, y, 16, bold);
  textRight(`N° ${data.reference}`, PAGE_W - M, y, 12, bold);
  y -= 16;
  if (data.mode === "retrait") {
    text("ENLÈVEMENT PAR LE CLIENT", M, y, 11, bold, alert);
    y -= 14;
  }

  // ── Bandeau ──────────────────────────────────────────────────────────────
  const colis = data.colis.length;
  const totalPieces = data.lines.reduce((s, l) => s + l.tailles.reduce((t, x) => t + x.quantite, 0), 0);
  const metas: [string, string][] = [
    ["Édité le", dateFr(data.editeLe)],
    [data.mode === "retrait" ? "Retrait prévu" : "Livraison promise", dateFr(data.datePlanifiee ?? data.datePromise)],
    ["Commande (ODF)", data.odfReferences.join(", ") || "-"],
    ["Pièces / colis", `${totalPieces} pcs / ${colis || "-"} colis`],
  ];
  const colW = CW / metas.length;
  page.drawRectangle({ x: M, y: y - 30, width: CW, height: 34, color: band });
  metas.forEach(([label, value], i) => {
    text(label.toUpperCase(), M + 8 + i * colW, y - 8, 6.5, bold, muted);
    text(wrap(value, colW - 12, 9.5, bold)[0] ?? "-", M + 8 + i * colW, y - 21, 9.5, bold);
  });
  y -= 46;

  // ── Client / lieu ────────────────────────────────────────────────────────
  const half = (CW - 14) / 2;
  const clientRows = [data.client.phone ? `Tél. ${data.client.phone}` : null, data.client.email].filter((v): v is string => !!v);
  const lieu = data.lieu;
  const lieuRows =
    data.mode === "retrait"
      ? [`Retrait dans les locaux de ${issuerName}.`]
      : [
          [lieu.zone, lieu.quartier].filter(Boolean).join(" - "),
          ...(lieu.repere ? wrap(`Repères : ${lieu.repere}`, half - 16, 8.5, font) : []),
          lieu.contactNom || lieu.contactTel ? `Sur place : ${[lieu.contactNom, lieu.contactTel].filter(Boolean).join(" - ")}` : "",
          lieu.horaires ? `Horaires : ${lieu.horaires}` : "",
          ...(lieu.consignes ? wrap(`Consignes : ${lieu.consignes}`, half - 16, 8.5, font) : []),
          lieu.latitude != null && lieu.longitude != null ? `GPS : ${Number(lieu.latitude).toFixed(5)}, ${Number(lieu.longitude).toFixed(5)}` : "",
        ].filter(Boolean);
  const boxH = 36 + Math.max(clientRows.length, lieuRows.length) * 11 + 6;
  const frame = (x: number, title: string, head: string, rows: string[]) => {
    page.drawRectangle({ x, y: y - boxH, width: half, height: boxH, borderColor: line, borderWidth: 0.8 });
    text(title, x + 8, y - 12, 6.5, bold, muted);
    text(wrap(head, half - 16, 10, bold)[0] ?? "", x + 8, y - 25, 10, bold);
    rows.forEach((r, i) => text(r, x + 8, y - 37 - i * 11, 8.5));
  };
  frame(M, "CLIENT", data.client.name, clientRows);
  frame(M + half + 14, data.mode === "retrait" ? "MODE" : "LIEU DE LIVRAISON", data.mode === "retrait" ? "Enlèvement par le client" : lieu.libelle ?? "-", lieuRows);
  y -= boxH + 20;

  // ── Articles ─────────────────────────────────────────────────────────────
  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 20, color: accent });
    const w = rgb(1, 1, 1);
    text("DÉSIGNATION", M + 6, y - 9, 8, bold, w);
    text("TAILLES ET QUANTITÉS", M + 220, y - 9, 8, bold, w);
    textRight("TOTAL", M + CW - 6, y - 9, 8, bold, w);
    y -= 24;
  };
  ensureSpace(60);
  drawHead();
  for (const l of data.lines) {
    const desc = wrap(l.designation, 205, 9, font);
    const tailles = wrap(l.tailles.map((t) => `${t.libelle} : ${t.quantite}`).join("   "), CW - 290, 9, font);
    const rowH = Math.max(desc.length, tailles.length) * 11.5 + 8;
    ensureSpace(rowH);
    desc.forEach((d, i) => text(d, M + 6, y - 9 - i * 11.5, 9));
    tailles.forEach((d, i) => text(d, M + 220, y - 9 - i * 11.5, 9));
    textRight(String(l.tailles.reduce((s, t) => s + t.quantite, 0)), M + CW - 6, y - 9, 9, bold);
    y -= rowH;
    hr(y + 3);
  }
  y -= 4;
  ensureSpace(20);
  textRight(`Total : ${totalPieces} pièce(s)`, M + CW - 6, y - 4, 9.5, bold);
  y -= 22;

  // ── Colis ────────────────────────────────────────────────────────────────
  if (data.colis.length > 0) {
    ensureSpace(30);
    text("COLIS", M, y, 7.5, bold, muted);
    y -= 12;
    const colisText = data.colis
      .map((c) => `n°${c.numero}${c.poidsKg ? ` (${String(c.poidsKg).replace(".", ",")} kg)` : ""}${c.contenu ? ` : ${c.contenu}` : ""}${c.codeQr ? ` [${c.codeQr}]` : ""}`)
      .join("   ");
    for (const l of wrap(colisText, CW, 8.5, font)) {
      ensureSpace(12);
      text(l, M, y, 8.5);
      y -= 11;
    }
    y -= 8;
  }

  // ── Règlement (L3) ───────────────────────────────────────────────────────
  if (data.reglement.mention) {
    const label = REGLEMENT_LABELS[data.reglement.mention];
    const montant =
      data.reglement.mention === "a_encaisser" && data.reglement.montant
        ? ` : ${formatMoney(data.reglement.montant, BASE_CURRENCY)}`
        : data.reglement.mention === "autre" && data.reglement.texte
          ? ` : ${data.reglement.texte}`
          : "";
    ensureSpace(30);
    const strong = data.reglement.mention === "a_encaisser";
    page.drawRectangle({ x: M, y: y - 18, width: CW, height: 24, color: strong ? rgb(0.99, 0.93, 0.93) : band });
    text(`Règlement : ${label}${montant}`, M + 8, y - 9, strong ? 11 : 9.5, bold, strong ? alert : ink);
    y -= 34;
  }

  // ── Décharge (L7 : manuscrite) et signature Seritex ─────────────────────
  const sigH = 110;
  ensureSpace(sigH + 10);
  page.drawRectangle({ x: M, y: y - sigH, width: half, height: sigH, borderColor: accent, borderWidth: 1 });
  text(data.mode === "retrait" ? "ENLÈVEMENT — DÉCHARGE DU CLIENT" : "DÉCHARGE DU CLIENT", M + 8, y - 13, 8.5, bold);
  text("Marchandise reçue conforme, en bon état.", M + 8, y - 25, 7.5, font, muted);
  ["Nom :", "Date :", "Signature et cachet :"].forEach((l, i) => text(l, M + 8, y - 42 - i * 16, 8.5));
  const sx = M + half + 14;
  page.drawRectangle({ x: sx, y: y - sigH, width: half, height: sigH, borderColor: line, borderWidth: 0.8 });
  text(`Pour ${issuerName}`, sx + 8, y - 13, 8.5, bold);
  text(data.livreur ? `Livré par : ${data.livreur}` : "Préparé et remis par", sx + 8, y - 25, 7.5, font, muted);
  if (assets.stamp) {
    const k = Math.min((half * 0.55) / assets.stamp.width, 70 / assets.stamp.height);
    page.drawImage(assets.stamp, { x: sx + half - assets.stamp.width * k - 12, y: y - sigH + 10, width: assets.stamp.width * k, height: assets.stamp.height * k, opacity: 0.92 });
  }
  if (assets.signature && data.seal) {
    const k = Math.min((half * 0.5) / assets.signature.width, 40 / assets.signature.height);
    page.drawImage(assets.signature, { x: sx + 12, y: y - sigH + 26, width: assets.signature.width * k, height: assets.signature.height * k });
    text(data.seal.name, sx + 8, y - sigH + 12, 8, bold);
  }
  y -= sigH + 10;

  // ── Pied de page ────────────────────────────────────────────────────────
  pages.forEach((p) => {
    page = p;
    const hrY = FOOT_BOTTOM + footerH - 6;
    hr(hrY);
    footerLines.forEach((l, i) => text(l, (PAGE_W - font.widthOfTextAtSize(safe(l), 7)) / 2, hrY - 11 - i * 9, 7, font, muted));
  });
}
