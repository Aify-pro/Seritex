import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { amountInWordsFr } from "@/lib/number-to-words-fr";
import type { DocumentSeal } from "@/lib/signatures";
import type { CompanySettings } from "@/lib/types/domain";
import { safe } from "@/lib/pdf/delivery-note-pdf";

/**
 * Bon de carburant (VEH-3) : une page A4 avec deux exemplaires identiques à
 * découper, « Station » et « Seritex ». Le bon porte un montant en FCFA (D5),
 * en chiffres et en lettres, et un cadre que la station remplit (litres,
 * montant servi, kilométrage) pour la justification au retour.
 */

export interface FuelVoucherPdfData {
  numero: string;
  valideLe: string;
  vehicule: { libelle: string; immatriculation: string | null; energie: string | null };
  beneficiaire: string | null;
  motif: string | null;
  station: string | null;
  montant: number;
  kmDemande: number | null;
  validePar: string | null;
  statut: string;
  issuer: CompanySettings | null;
  seal: DocumentSeal | null;
  logoPng: Uint8Array;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const CW = PAGE_W - M * 2;
const ink = rgb(0.11, 0.09, 0.09);
const muted = rgb(0.42, 0.4, 0.38);
const line = rgb(0.86, 0.84, 0.81);
const band = rgb(0.95, 0.94, 0.92);
const alert = rgb(0.7, 0.1, 0.1);

const fmt = (n: number) => safe(new Intl.NumberFormat("fr-FR").format(n));
const dateFr = (v: string) => safe(new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(v)));

export async function buildFuelVoucherPdf(data: FuelVoucherPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bon de carburant ${data.numero}`);
  pdf.setProducer("Seritex");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(data.logoPng);
  const stamp = data.seal?.stampPng ? await pdf.embedPng(data.seal.stampPng) : null;
  const signature = data.seal ? await pdf.embedPng(data.seal.signaturePng) : null;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const half = PAGE_H / 2;
  drawCopy(page, data, "Exemplaire station", PAGE_H - M, { font, bold, logo, stamp, signature });
  // Ligne de découpe.
  page.drawLine({ start: { x: 18, y: half }, end: { x: PAGE_W - 18, y: half }, thickness: 0.6, color: muted, dashArray: [4, 3] });
  page.drawText(safe("- - découper ici - -"), { x: PAGE_W / 2 - 30, y: half + 3, size: 6, font, color: muted });
  drawCopy(page, data, `Exemplaire ${data.issuer?.raison_sociale || "Seritex"}`, half - 22, { font, bold, logo, stamp, signature });
  return pdf.save();
}

function drawCopy(
  page: PDFPage,
  data: FuelVoucherPdfData,
  exemplaire: string,
  top: number,
  a: { font: PDFFont; bold: PDFFont; logo: PDFImage; stamp: PDFImage | null; signature: PDFImage | null }
) {
  const { font, bold, logo } = a;
  const text = (s: string, x: number, y: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xr: number, y: number, size: number, f: PDFFont = font, color = ink) => {
    const t = safe(s);
    page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  let y = top;

  // En-tête
  const logoH = 34;
  page.drawImage(logo, { x: M, y: y - logoH, width: logoH * (logo.width / logo.height), height: logoH });
  right(exemplaire, PAGE_W - M, y - 8, 8, bold, muted);
  right(`Validé le ${dateFr(data.valideLe)}`, PAGE_W - M, y - 20, 8, font, muted);
  y -= logoH + 14;
  text("BON DE CARBURANT", M, y, 15, bold);
  right(`N° ${data.numero}`, PAGE_W - M, y, 13, bold);
  y -= 8;
  if (data.statut === "annule" || data.statut === "refuse") {
    text(data.statut === "annule" ? "BON ANNULÉ - NE PAS SERVIR" : "BON REFUSÉ - NE PAS SERVIR", M, y - 12, 11, bold, alert);
    y -= 14;
  }
  y -= 10;

  // Bandeau véhicule
  const metas: [string, string][] = [
    ["Véhicule", data.vehicule.libelle],
    ["Immatriculation", data.vehicule.immatriculation ?? "-"],
    ["Carburant", data.vehicule.energie ? data.vehicule.energie.charAt(0).toUpperCase() + data.vehicule.energie.slice(1) : "-"],
    ["Compteur au départ", data.kmDemande !== null ? `${fmt(data.kmDemande)} km` : "-"],
  ];
  const colW = CW / metas.length;
  page.drawRectangle({ x: M, y: y - 30, width: CW, height: 34, color: band });
  metas.forEach(([label, value], i) => {
    text(label.toUpperCase(), M + 8 + i * colW, y - 8, 6.5, bold, muted);
    text(value.slice(0, 26), M + 8 + i * colW, y - 21, 9.5, bold);
  });
  y -= 46;

  // Montant
  text("MONTANT AUTORISÉ", M, y, 7, bold, muted);
  right(`${fmt(data.montant)} FCFA`, PAGE_W - M, y - 4, 18, bold);
  text(amountInWordsFr(data.montant), M, y - 14, 9);
  y -= 32;
  const infos: [string, string][] = [
    ["Bénéficiaire (chauffeur)", data.beneficiaire ?? "-"],
    ["Station", data.station ?? "Toute station"],
    ["Motif", data.motif ?? "-"],
  ];
  for (const [label, value] of infos) {
    text(label, M, y, 8.5, bold, muted);
    text(value.slice(0, 90), M + 130, y, 9);
    y -= 13;
  }
  y -= 6;

  // Cadre station + visa
  const boxH = 92;
  const leftW = CW * 0.6;
  page.drawRectangle({ x: M, y: y - boxH, width: leftW - 8, height: boxH, borderColor: line, borderWidth: 0.8 });
  text("À REMPLIR PAR LA STATION", M + 8, y - 12, 7, bold, muted);
  const fields = ["Date et heure du plein", "Litres servis", "Montant servi (FCFA)", "Kilométrage au compteur"];
  fields.forEach((f, i) => {
    const yy = y - 30 - i * 16;
    text(f, M + 8, yy, 8.5);
    page.drawLine({ start: { x: M + 140, y: yy - 2 }, end: { x: M + leftW - 20, y: yy - 2 }, thickness: 0.5, color: line });
  });
  const vx = M + leftW;
  const vw = CW - leftW;
  page.drawRectangle({ x: vx, y: y - boxH, width: vw, height: boxH, borderColor: line, borderWidth: 0.8 });
  text("VISA LOGISTIQUE", vx + 8, y - 12, 7, bold, muted);
  text(data.seal?.name ?? data.validePar ?? "", vx + 8, y - 24, 8.5, bold);
  if (data.seal?.fonction) text(data.seal.fonction, vx + 8, y - 35, 7.5, font, muted);
  if (a.stamp) {
    const h = 54;
    page.drawImage(a.stamp, { x: vx + vw - h * (a.stamp.width / a.stamp.height) - 8, y: y - boxH + 6, width: h * (a.stamp.width / a.stamp.height), height: h, opacity: 0.85 });
  }
  if (a.signature) {
    const h = 34;
    page.drawImage(a.signature, { x: vx + 10, y: y - boxH + 8, width: h * (a.signature.width / a.signature.height), height: h });
  }
  y -= boxH + 10;
  text("Signature du chauffeur : ......................................", M, y, 8.5);
  right("Le ticket de la station est à rapporter à la logistique.", PAGE_W - M, y, 7.5, font, muted);
}
