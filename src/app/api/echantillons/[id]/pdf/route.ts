import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import {
  SAMPLE_STATUS_LABELS,
  SAMPLE_PRIORITY_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  type SampleRequestStatus,
  type SamplePriority,
  type ProductionOrderStatus,
} from "@/lib/types/domain";

/**
 * Génération du bon imprimable de la fiche échantillon (section 5.2 de
 * l'analyse : "Impression des bons de travail... génération PDF... QR
 * code"). Le PDF est construit à la demande, jamais mis en cache côté
 * serveur — il reflète toujours l'état courant de la fiche. Le QR code y
 * est conservé (contrairement à l'affichage en liste du module) : il encode
 * la même URL absolue que celle affichée dans la fenêtre de
 * prévisualisation, pour rester scannable depuis un mobile même sur le
 * document imprimé.
 *
 * L'authentification suit le même client Supabase (cookies de session) que
 * le reste de l'application : la RLS s'applique donc identiquement, un
 * client ne peut jamais obtenir le PDF d'un échantillon d'une autre
 * entreprise même en devinant un identifiant.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: sample } = await supabase
    .from("sample_requests")
    .select(
      "id,reference,sample_number,need_description,quantity_requested,status,priority,request_date,due_date,extra_info,production_orders(reference,status),companies(name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!sample) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });

  const company = sample.companies as unknown as { name: string } | null;
  const productionOrder = sample.production_orders as unknown as { reference: string; status: ProductionOrderStatus } | null;

  const baseUrl = await getBaseUrl();
  const sheetUrl = `${baseUrl}/echantillons/${sample.sample_number}`;
  const qrPngBytes = await QRCode.toBuffer(sheetUrl, { type: "png", width: 260, margin: 1 });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Fiche échantillon ${sample.sample_number}`);
  pdfDoc.setProducer("Seritex");

  const PAGE_WIDTH = 595.28; // A4 portrait, points
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const qrImage = await pdfDoc.embedPng(qrPngBytes);

  const brand = rgb(0.059, 0.298, 0.361); // #0f4c5c
  const ink = rgb(0.11, 0.09, 0.09);
  const muted = rgb(0.42, 0.4, 0.38);

  let y = PAGE_HEIGHT - MARGIN;

  function wrap(str: string, maxWidth: number, size: number, useFont: PDFFont): string[] {
    const words = str.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (useFont.widthOfTextAtSize(attempt, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawLine(str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const size = opts.size ?? 11;
    page.drawText(str, { x: MARGIN, y, size, font: opts.bold ? fontBold : font, color: opts.color ?? ink });
    y -= size + (opts.gap ?? 8);
  }

  function drawField(label: string, value: string) {
    page.drawText(label.toUpperCase(), { x: MARGIN, y, size: 8, font: fontBold, color: muted });
    y -= 12;
    for (const line of wrap(value || "—", CONTENT_WIDTH - 130, 11, font)) {
      page.drawText(line, { x: MARGIN, y, size: 11, font, color: ink });
      y -= 15;
    }
    y -= 6;
  }

  // En-tête
  page.drawText("SERITEX", { x: MARGIN, y, size: 20, font: fontBold, color: brand });
  y -= 22;
  drawLine("Fiche échantillon", { size: 12, color: muted, gap: 14 });

  // QR code en haut à droite
  const qrSize = 92;
  page.drawImage(qrImage, {
    x: PAGE_WIDTH - MARGIN - qrSize,
    y: PAGE_HEIGHT - MARGIN - qrSize + 8,
    width: qrSize,
    height: qrSize,
  });
  page.drawText(sample.sample_number, {
    x: PAGE_WIDTH - MARGIN - qrSize,
    y: PAGE_HEIGHT - MARGIN - qrSize - 6,
    size: 8,
    font: fontBold,
    color: ink,
  });

  y -= 10;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.9, 0.88, 0.85),
  });
  y -= 24;

  drawField("Référence", sample.reference);
  drawField("Client", company?.name ?? "—");
  drawField("Besoin exprimé", sample.need_description);
  drawField("Quantité demandée", String(sample.quantity_requested));
  drawField("Priorité", SAMPLE_PRIORITY_LABELS[sample.priority as SamplePriority]);
  drawField("Statut", SAMPLE_STATUS_LABELS[sample.status as SampleRequestStatus]);
  drawField("Date de la demande", formatFr(sample.request_date));
  drawField("Délai souhaité", sample.due_date ? formatFr(sample.due_date) : "—");
  if (sample.extra_info) drawField("Informations complémentaires", sample.extra_info);
  drawField(
    "Ordre de fabrication lié",
    productionOrder ? `${productionOrder.reference} · ${PRODUCTION_ORDER_STATUS_LABELS[productionOrder.status]}` : "aucun"
  );

  page.drawText(`Document généré le ${formatFr(new Date().toISOString())} — ${sheetUrl}`, {
    x: MARGIN,
    y: MARGIN / 2,
    size: 7,
    font,
    color: muted,
  });

  const pdfBytes = await pdfDoc.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="fiche-echantillon-${sample.sample_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function formatFr(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
