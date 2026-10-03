import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { safe } from "@/lib/pdf/delivery-note-pdf";

/**
 * Étiquettes de colis (SF-5) : une page A6 par colis — client, BL, numéro de
 * colis, contenu, et le QR du lot qu'il contient (lu en atelier comme en
 * livraison, il ouvre la fiche du lot et sa traçabilité). Sans lot, le QR
 * renvoie à l'expédition.
 */
export interface PackageLabel {
  numero: number;
  total: number;
  contenu: string | null;
  poidsKg: number | null;
  lotCode: string | null;
  qrPng: Uint8Array;
}

export async function buildPackageLabelsPdf(data: {
  blReference: string;
  client: string;
  lieu: string | null;
  labels: PackageLabel[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 298;
  const H = 420;
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);

  for (const l of data.labels) {
    const page = doc.addPage([W, H]);
    let y = H - 36;
    page.drawText(safe(data.client).slice(0, 40), { x: 20, y, size: 14, font: bold, color: ink });
    y -= 18;
    if (data.lieu) {
      page.drawText(safe(data.lieu).slice(0, 55), { x: 20, y, size: 9, font, color: muted });
      y -= 16;
    }
    page.drawText(`BL ${safe(data.blReference)}`, { x: 20, y, size: 11, font: bold, color: ink });
    page.drawText(`Colis ${l.numero} / ${l.total}`, { x: W - 20 - bold.widthOfTextAtSize(`Colis ${l.numero} / ${l.total}`, 16), y, size: 16, font: bold, color: ink });
    y -= 18;
    if (l.contenu) {
      page.drawText(safe(l.contenu).slice(0, 55), { x: 20, y, size: 9, font, color: ink });
      y -= 13;
    }
    if (l.poidsKg) {
      page.drawText(`${String(l.poidsKg).replace(".", ",")} kg`, { x: 20, y, size: 9, font, color: muted });
    }
    const qr = await doc.embedPng(l.qrPng);
    const size = 190;
    page.drawImage(qr, { x: (W - size) / 2, y: 50, width: size, height: size });
    const caption = l.lotCode ? `Lot ${l.lotCode}` : "Aucun lot : QR de l'expédition";
    page.drawText(safe(caption), { x: (W - bold.widthOfTextAtSize(safe(caption), 12)) / 2, y: 32, size: 12, font: bold, color: ink });
  }
  return doc.save();
}
