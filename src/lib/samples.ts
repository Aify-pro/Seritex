import { createClient } from "@/lib/supabase/server";
import type { QuoteStatus } from "@/lib/types/domain";

/** Demande proposable au rattachement d'une fiche échantillon (migration 0051). */
export interface SampleRequestOption {
  id: string;
  reference: string;
  companyId: string;
  companyName: string;
  description: string | null;
}

/**
 * Ligne d'article d'un devis de la demande, proposable au lien échantillon.
 * `orderLine` renseigné = la ligne est déjà passée en ODF : le lien est
 * alors verrouillé et suit cet article (trigger enforce_sample_links).
 */
export interface SampleQuoteLineOption {
  id: string;
  requestId: string;
  quoteReference: string;
  quoteStatus: QuoteStatus;
  description: string;
  orderLine: { id: string; orderReference: string } | null;
}

/** Toutes les demandes, pour le sélecteur de création du module Échantillonnage. */
export async function getSampleRequestOptions(): Promise<SampleRequestOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("requests")
    .select("id,reference,company_id,description,companies(name)")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    companyId: r.company_id,
    companyName: (r.companies as unknown as { name: string } | null)?.name ?? "",
    description: r.description,
  }));
}

/**
 * Lignes de devis des demandes données, avec l'article d'ODF qui en est
 * issu le cas échéant — deux requêtes simples plutôt qu'un embed
 * quote_lines → production_order_lines, que la double clé étrangère de
 * sample_requests (quote_line_id + production_order_line_id) pourrait
 * rendre ambigu côté PostgREST.
 */
export async function getSampleQuoteLineOptions(requestIds: string[]): Promise<SampleQuoteLineOption[]> {
  if (requestIds.length === 0) return [];
  const supabase = await createClient();
  const { data: lines } = await supabase
    .from("quote_lines")
    .select("id,description,quotes!inner(reference,status,request_id,created_at)")
    .in("quotes.request_id", requestIds);

  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: orderLines } =
    lineIds.length > 0
      ? await supabase.from("production_order_lines").select("id,quote_line_id,production_orders(reference)").in("quote_line_id", lineIds)
      : { data: [] };

  const orderLineByQuoteLine = new Map<string, { id: string; orderReference: string }>();
  for (const ol of orderLines ?? []) {
    const po = ol.production_orders as unknown as { reference: string } | null;
    if (ol.quote_line_id) orderLineByQuoteLine.set(ol.quote_line_id, { id: ol.id, orderReference: po?.reference ?? "ODF" });
  }

  return (lines ?? [])
    .map((l) => {
      const q = l.quotes as unknown as { reference: string; status: QuoteStatus; request_id: string; created_at: string };
      return {
        option: {
          id: l.id,
          requestId: q.request_id,
          quoteReference: q.reference,
          quoteStatus: q.status,
          description: l.description,
          orderLine: orderLineByQuoteLine.get(l.id) ?? null,
        },
        quoteCreatedAt: q.created_at,
      };
    })
    .sort((a, b) => b.quoteCreatedAt.localeCompare(a.quoteCreatedAt))
    .map((x) => x.option);
}

/**
 * Rattachements d'une fiche pour `SampleDetailContent`, calculés à partir
 * des options déjà chargées pour toute la page (pas de requête par fiche).
 */
export function buildSampleLinks(
  sample: { company_id: string; request_id: string | null },
  requests: SampleRequestOption[],
  quoteLines: SampleQuoteLineOption[]
) {
  const request = sample.request_id ? requests.find((r) => r.id === sample.request_id) : undefined;
  return {
    request: request ? { id: request.id, reference: request.reference } : null,
    quoteLines: sample.request_id ? quoteLines.filter((l) => l.requestId === sample.request_id) : [],
    attachableRequests: sample.request_id ? [] : requests.filter((r) => r.companyId === sample.company_id),
  };
}
