import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PRODUCTION_ORDER_STATUS_LABELS, type ProductionOrderStatus } from "@/lib/types/domain";

/**
 * Génération du bon imprimable de l'ordre de fabrication — même principe
 * que la fiche échantillon (api/echantillons/[id]/pdf) : construit à la
 * demande, jamais mis en cache, reflète toujours l'état courant de l'ODF.
 *
 * Porte les mentions demandées par le document de logique consolidée
 * (section 4) : le nom de la personne qui a validé le lancement et celui
 * qui a validé la clôture définitive doivent apparaître sur le PDF, au même
 * titre qu'à l'écran.
 *
 * L'authentification suit le même client Supabase (cookies de session) que
 * le reste de l'application — la RLS s'applique identiquement.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: order } = await supabase
    .from("production_orders")
    .select("*,companies(name),quotes(reference)")
    .eq("id", id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Ordre de fabrication introuvable" }, { status: 404 });

  const [{ data: sections }, { data: sizes }, { data: workOrders }, { data: fiche }] = await Promise.all([
    supabase
      .from("production_order_sections")
      .select("ordre,sections(name)")
      .eq("production_order_id", id)
      .order("ordre"),
    supabase.from("production_order_sizes").select("taille,quantite_demandee").eq("production_order_id", id),
    supabase.from("work_orders").select("reference,quantity_planned,quantity_done,sections(name)").eq("production_order_id", id),
    supabase.from("fiches_placement").select("numero_ot,statut").eq("odf_id", id).maybeSingle(),
  ]);

  const userIds = [order.launched_by, order.cloture_demandee_par, order.closed_by].filter(
    (v): v is string => !!v
  );
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => users?.find((u) => u.id === userId)?.full_name ?? "—";

  const company = order.companies as unknown as { name: string } | null;
  const quote = order.quotes as unknown as { reference: string } | null;
  const baseUrl = await getBaseUrl();
  const sheetUrl = `${baseUrl}/atelier/production/${order.id}`;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Ordre de fabrication ${order.reference}`);
  pdfDoc.setProducer("Seritex");

  const PAGE_WIDTH = 595.28; // A4 portrait, points
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const brand = rgb(0.059, 0.298, 0.361); // #0f4c5c
  const ink = rgb(0.11, 0.09, 0.09);
  const muted = rgb(0.42, 0.4, 0.38);
  const rule = rgb(0.9, 0.88, 0.85);

  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

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

  function drawField(label: string, value: string) {
    ensureSpace(30);
    page.drawText(label.toUpperCase(), { x: MARGIN, y, size: 8, font: fontBold, color: muted });
    y -= 12;
    for (const line of wrap(value || "—", CONTENT_WIDTH, 11, font)) {
      ensureSpace(15);
      page.drawText(line, { x: MARGIN, y, size: 11, font, color: ink });
      y -= 15;
    }
    y -= 6;
  }

  function drawSectionTitle(str: string) {
    ensureSpace(30);
    y -= 6;
    page.drawText(str, { x: MARGIN, y, size: 12, font: fontBold, color: brand });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: rule });
    y -= 16;
  }

  // En-tête
  page.drawText("SERITEX", { x: MARGIN, y, size: 20, font: fontBold, color: brand });
  y -= 22;
  page.drawText("Ordre de fabrication", { x: MARGIN, y, size: 12, font, color: muted });
  y -= 14;
  page.drawText(PRODUCTION_ORDER_STATUS_LABELS[order.status as ProductionOrderStatus], {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: ink,
  });
  y -= 20;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rule });
  y -= 24;

  drawField("Référence", order.reference);
  drawField("Client", company?.name ?? "—");
  drawField("Devis d'origine", quote?.reference ?? "—");
  drawField("Quantité totale", `${order.total_quantity} pièces`);
  drawField("Début planifié", order.planned_start_date ? formatFr(order.planned_start_date) : "—");
  drawField("Fin planifiée", order.planned_end_date ? formatFr(order.planned_end_date) : "—");

  drawSectionTitle("Composition");
  drawField(
    "Sections retenues",
    (sections ?? [])
      .map((s) => (s.sections as unknown as { name: string } | null)?.name)
      .filter(Boolean)
      .join(", ") || "aucune"
  );
  drawField(
    "Quantités par taille",
    (sizes ?? []).map((s) => `${s.taille} : ${s.quantite_demandee}`).join(" · ") || "aucune"
  );
  if (fiche) {
    drawField("Fiche Patronnage liée", `${fiche.numero_ot} (${fiche.statut})`);
  }
  if (order.mention_surplus_traces) {
    drawField(
      "Surplus tracé vs quantité demandée",
      Object.entries(order.mention_surplus_traces as Record<string, number>)
        .map(([taille, surplus]) => `${taille} : +${surplus}`)
        .join(" · ")
    );
  }

  if (workOrders && workOrders.length > 0) {
    drawSectionTitle("Avancement des sous-ODF");
    for (const wo of workOrders) {
      const sectionName = (wo.sections as unknown as { name: string } | null)?.name ?? "—";
      drawField(`${sectionName} — ${wo.reference}`, `${wo.quantity_done} / ${wo.quantity_planned} pièces`);
    }
  }

  drawSectionTitle("Cycle de vie");
  if (order.launched_at) {
    drawField("Lancé le", `${formatFr(order.launched_at)} par ${nameOf(order.launched_by)}`);
  }
  if (order.cloture_demandee_at) {
    drawField("Clôture demandée le", `${formatFr(order.cloture_demandee_at)} par ${nameOf(order.cloture_demandee_par)}`);
  }
  if (order.closed_at) {
    drawField("Clôturé le", `${formatFr(order.closed_at)} par ${nameOf(order.closed_by)}`);
  }
  if (order.cloture_note) {
    drawField("Note de clôture", order.cloture_note);
  }

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
      "Content-Disposition": `inline; filename="odf-${order.reference}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function formatFr(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
