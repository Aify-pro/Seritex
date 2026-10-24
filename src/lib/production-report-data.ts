import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ReportContenu, ReportCouts, ReportDecision } from "@/lib/production-report";

/**
 * Rapports de production d'un ODF (migration 0145), lus avec le client de
 * session : la RLS fait foi (rapport visible de qui voit l'ODF, données de
 * valeur réservées à tarification/voir). Partagé par la fiche ODF et le PDF.
 */

export interface ReportSummary {
  id: string;
  numero: number;
  genereLe: string;
  decision: ReportDecision | null;
}

export interface LoadedReport extends ReportSummary {
  demandePar: string | null;
  motifDemande: string | null;
  decisionNote: string | null;
  decisionPar: string | null;
  decisionLe: string | null;
  contenu: ReportContenu;
  /** Null sans le droit tarification/voir (ou si la ligne manque). */
  couts: ReportCouts | null;
}

export async function getProductionReports(
  productionOrderId: string,
  { numero, withCosts }: { numero?: number; withCosts: boolean }
): Promise<{ list: ReportSummary[]; report: LoadedReport | null }> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("production_reports")
    .select("id,numero,genere_le,decision")
    .eq("production_order_id", productionOrderId)
    .order("numero", { ascending: false });
  const list: ReportSummary[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    numero: r.numero as number,
    genereLe: r.genere_le as string,
    decision: (r.decision as ReportDecision | null) ?? null,
  }));
  const choisi = list.find((r) => r.numero === numero) ?? list[0];
  if (!choisi) return { list, report: null };

  const [{ data: r }, { data: couts }] = await Promise.all([
    supabase
      .from("production_reports")
      .select("demande_par,motif_demande,decision_note,decision_par,decision_le,contenu")
      .eq("id", choisi.id)
      .single(),
    withCosts
      ? supabase.from("production_report_couts").select("contenu").eq("report_id", choisi.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!r) return { list, report: null };

  const userIds = [r.demande_par, r.decision_par].filter((v): v is string => !!v);
  const { data: users } = userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (id: string | null) => (id ? ((users ?? []).find((u) => u.id === id)?.full_name as string | undefined) ?? null : null);

  return {
    list,
    report: {
      ...choisi,
      demandePar: nameOf(r.demande_par as string | null),
      motifDemande: (r.motif_demande as string | null) ?? null,
      decisionNote: (r.decision_note as string | null) ?? null,
      decisionPar: nameOf(r.decision_par as string | null),
      decisionLe: (r.decision_le as string | null) ?? null,
      contenu: r.contenu as ReportContenu,
      couts: ((couts as { contenu: ReportCouts } | null)?.contenu as ReportCouts | undefined) ?? null,
    },
  };
}
