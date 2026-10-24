import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/utils";
import { getSizes } from "@/lib/sizes";
import { odfClientLabel } from "@/lib/production/client-label";
import { getProductionReports } from "@/lib/production-report-data";
import { buildReportValeur, buildReportView, DECISION_LABELS } from "@/lib/production-report";
import { buildProductionReportPdf } from "@/lib/pdf/production-report-pdf";

/**
 * Rapport de production imprimable (migration 0145) : le rapport figé
 * `?numero=N` (le dernier par défaut). Même client de session que la fiche
 * ODF : la RLS fait foi, et la partie Valeurs n'est imprimée qu'avec le
 * droit Tarification. La mise en page vit dans `@/lib/pdf/production-report-pdf`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: order } = await supabase.from("production_orders").select("reference,company_id,companies(name)").eq("id", id).maybeSingle();
  if (!order) return NextResponse.json({ error: "Ordre de fabrication introuvable" }, { status: 404 });

  const numeroParam = req.nextUrl.searchParams.get("numero");
  const canSeeCosts = await can("tarification", "view");
  const [{ report }, sizes] = await Promise.all([
    getProductionReports(id, { numero: numeroParam ? Number(numeroParam) : undefined, withCosts: canSeeCosts }),
    getSizes(),
  ]);
  if (!report) return NextResponse.json({ error: "Aucun rapport de production pour cet ODF" }, { status: 404 });

  const view = buildReportView(report.contenu);
  const pdfBytes = await buildProductionReportPdf({
    reference: order.reference as string,
    client: odfClientLabel(order.company_id as string | null, (order.companies as unknown as { name: string } | null)?.name),
    numero: report.numero,
    genereLe: report.genereLe,
    demandePar: report.demandePar,
    motifDemande: report.motifDemande,
    decision: report.decision ? DECISION_LABELS[report.decision] : null,
    decisionLe: report.decisionLe,
    decisionPar: report.decisionPar,
    decisionNote: report.decisionNote,
    view,
    valeur: canSeeCosts && report.couts ? buildReportValeur(view, report.couts) : null,
    tailleLabel: (cle) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle,
    formatDateTime: (v) => formatDateTime(v),
    formatMoney: (v) => (v === null ? "-" : formatMoney(Math.round(v))),
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rapport-${order.reference}-${report.numero}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
