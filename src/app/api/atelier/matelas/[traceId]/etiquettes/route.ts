import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getSizes } from "@/lib/sizes";
import { buildLabelSheetPdf, formatLabelDate } from "@/lib/pdf/waste-bag-label";

/**
 * Planche A4 des étiquettes d'un matelas clôturé — une étiquette par taille
 * obtenue (QR, sous-ODF, taille et quantité, date de clôture). Reconstruite à
 * la demande depuis l'événement de clôture, jamais mise en cache.
 *
 * Même garde que la file de la section : personnel connecté, jamais un
 * client ; la lecture passe par la RLS de l'utilisateur.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  const workOrderId = req.nextUrl.searchParams.get("workOrderId");

  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client") return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (!workOrderId) return NextResponse.json({ error: "workOrderId manquant" }, { status: 400 });

  const supabase = await createClient();
  const { data: wo } = await supabase
    .from("work_orders")
    .select("reference,production_order_id")
    .eq("id", workOrderId)
    .maybeSingle();
  const { data: event } = await supabase
    .from("work_order_events")
    .select("occurred_at,quantites_obtenues")
    .eq("event_type", "matelas_cloture")
    .eq("work_order_id", workOrderId)
    .eq("trace_id", traceId)
    .maybeSingle();

  if (!wo || !event) return NextResponse.json({ error: "Matelas clôturé introuvable" }, { status: 404 });

  const quantites = (event.quantites_obtenues ?? {}) as Record<string, number>;
  const referentiel = await getSizes();
  const connues = new Set(referentiel.map((t) => t.cle));
  const tailles = [
    ...referentiel.filter((t) => (quantites[t.cle] ?? 0) > 0).map((t) => ({ cle: t.cle, libelle: t.libelle })),
    ...Object.keys(quantites)
      .filter((cle) => !connues.has(cle) && quantites[cle] > 0)
      .map((cle) => ({ cle, libelle: cle })),
  ];
  if (tailles.length === 0) return NextResponse.json({ error: "Aucune quantité obtenue" }, { status: 404 });

  const url = `${await getBaseUrl()}/atelier/section?odf=${wo.production_order_id}`;
  const date = formatLabelDate(event.occurred_at);
  const pdfBytes = await buildLabelSheetPdf(
    tailles.map((t) => ({ url, lines: [wo.reference, `${t.libelle} · ${quantites[t.cle]} pcs`, date] })),
    `Étiquettes ${wo.reference}`
  );

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiquettes-${wo.reference}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
