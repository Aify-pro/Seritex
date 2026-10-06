import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getMediaFileBuffers } from "@/lib/media/preview";
import { getSampleArticleMediaMap } from "@/lib/samples";
import { buildSamplePdf, type SamplePdfData } from "@/lib/pdf/sample-pdf";
import {
  SAMPLE_STATUS_LABELS,
  SAMPLE_PRIORITY_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  type SampleRequestStatus,
  type SamplePriority,
  type ProductionOrderStatus,
} from "@/lib/types/domain";

/**
 * Bon imprimable de la fiche échantillon. La mise en page vit dans
 * `src/lib/pdf/sample-pdf.ts` (fiche en haut, étiquette détachable en bas,
 * demande Ayman 06/10) — cette route ne fait que rassembler les données,
 * même séparation que l'ordre de fabrication. Construit à la demande,
 * jamais mis en cache : il reflète toujours l'état courant de la fiche.
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
      "id,reference,sample_number,need_description,status,priority,request_date,due_date,extra_info,request_id,quote_line_id,production_order_line_id,companies(name),requests(reference),quote_lines(description,quotes(reference)),production_order_lines(description,production_orders(reference,status))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!sample) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });

  const company = sample.companies as unknown as { name: string } | null;
  // Par article d'ODF depuis 0044 (l'ancienne jointure production_orders
  // n'existe plus) ; demande et ligne de devis depuis 0051.
  const request = sample.requests as unknown as { reference: string } | null;
  const quoteLine = sample.quote_lines as unknown as { description: string; quotes: { reference: string } | null } | null;
  const orderLine = sample.production_order_lines as unknown as {
    description: string;
    production_orders: { reference: string; status: ProductionOrderStatus } | null;
  } | null;

  // Maquette et visuels de l'article (0094) : ils vivent sur la ligne
  // d'article, pas sur la fiche — même source que l'écran.
  const articleMedia = (
    await getSampleArticleMediaMap([
      {
        id: sample.id,
        request_id: sample.request_id,
        quote_line_id: sample.quote_line_id,
        production_order_line_id: sample.production_order_line_id,
      },
    ])
  ).get(sample.id)!;

  // Octets de la maquette pour l'imprimer sur la fiche. Un format que
  // pdf-lib ne sait pas lire (PDF, AI, SVG) n'est pas une erreur : la mise
  // en page affiche alors le nom du fichier à la place de l'image.
  let maquette: SamplePdfData["maquette"] = null;
  if (articleMedia.maquette) {
    const bytes = (await getMediaFileBuffers([articleMedia.maquette.id])).get(articleMedia.maquette.id);
    const isPng = bytes?.mimeType === "image/png" || articleMedia.maquette.file_name.toLowerCase().endsWith(".png");
    maquette = {
      bytes: bytes?.buffer ?? Buffer.alloc(0),
      format: isPng ? "png" : "jpg",
      fileName: articleMedia.maquette.file_name,
    };
  }

  const baseUrl = await getBaseUrl();
  const pdfBytes = await buildSamplePdf({
    sampleNumber: sample.sample_number,
    reference: sample.reference,
    statusLabel: SAMPLE_STATUS_LABELS[sample.status as SampleRequestStatus],
    priorityLabel: SAMPLE_PRIORITY_LABELS[sample.priority as SamplePriority],
    companyName: company?.name ?? null,
    requestReference: request?.reference ?? null,
    quoteLineLabel: quoteLine ? `${quoteLine.quotes?.reference ?? "Devis"} - ${quoteLine.description}` : null,
    orderLineLabel: orderLine?.production_orders
      ? `${orderLine.production_orders.reference} - ${orderLine.description} (${PRODUCTION_ORDER_STATUS_LABELS[orderLine.production_orders.status]})`
      : null,
    needDescription: sample.need_description,
    extraInfo: sample.extra_info,
    requestDate: formatFr(sample.request_date),
    dueDate: sample.due_date ? formatFr(sample.due_date) : null,
    visuelNames: articleMedia.visuels.map((f) => f.file_name),
    requiresVisuel: articleMedia.requiresVisuel,
    maquette,
    sheetUrl: `${baseUrl}/echantillons/${sample.sample_number}`,
    generatedAt: formatFr(new Date().toISOString()),
  });

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
