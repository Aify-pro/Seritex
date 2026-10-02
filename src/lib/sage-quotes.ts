import { createClient } from "@/lib/supabase/server";

/**
 * Devis Sage en cours (migration 0071) : lecture du miroir alimenté par
 * scripts/sage-nas-sync, pour les récupérer depuis une demande. Lecture
 * seule : Seritex n'écrit jamais dans ces tables.
 */
export interface SageQuoteSummary {
  sage_piece: string;
  doc_date: string | null;
  client_ref: string | null;
  total_ht: number;
  total_ttc: number;
  date_livraison: string | null;
  line_count: number;
  /** Référence du devis Seritex déjà créé à partir de celui-ci, le cas échéant. */
  importedAs: string | null;
  /** Renseigné seulement pour une recherche par numéro : client Sage et fiche Seritex éventuelle. */
  client_sage_code?: string;
  client_name?: string | null;
  sameClient?: boolean;
}

export interface SagePrefillLine {
  description: string;
  quantity: number;
  unit_price: number;
  remise_pct: number;
  ar_ref: string | null;
}

/** Données d'un devis Sage pour préremplir le formulaire de devis. */
export interface SagePrefill {
  sagePiece: string;
  clientRef: string | null;
  dateLivraison: string | null;
  /** Taux de TVA le plus fréquent des lignes ; null si Sage n'en donne pas. */
  tvaRate: number | null;
  totalHt: number;
  totalTtc: number;
  deviseNo: number | null;
  lines: SagePrefillLine[];
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Résumés (avec nombre de lignes et statut d'import) pour une liste d'en-têtes. */
async function summarize(
  supabase: Supabase,
  headers: { sage_piece: string; doc_date: string | null; client_ref: string | null; total_ht: number; total_ttc: number; date_livraison: string | null; client_sage_code: string }[]
): Promise<SageQuoteSummary[]> {
  if (headers.length === 0) return [];
  const pieces = headers.map((h) => h.sage_piece);
  const [{ data: lines }, { data: imported }] = await Promise.all([
    supabase.from("sage_quote_lines_view").select("sage_piece").in("sage_piece", pieces),
    supabase.from("quotes").select("sage_piece,reference").in("sage_piece", pieces),
  ]);
  const counts = new Map<string, number>();
  for (const l of lines ?? []) counts.set(l.sage_piece, (counts.get(l.sage_piece) ?? 0) + 1);
  const importedBy = new Map((imported ?? []).map((q) => [q.sage_piece as string, q.reference as string]));
  return headers.map((h) => ({
    sage_piece: h.sage_piece,
    doc_date: h.doc_date,
    client_ref: h.client_ref,
    total_ht: Number(h.total_ht),
    total_ttc: Number(h.total_ttc),
    date_livraison: h.date_livraison,
    line_count: counts.get(h.sage_piece) ?? 0,
    importedAs: importedBy.get(h.sage_piece) ?? null,
  }));
}

const HEADER_COLUMNS = "sage_piece,doc_date,client_ref,total_ht,total_ttc,date_livraison,client_sage_code";

/** Devis Sage en cours d'un client (par code Sage), du plus récent au plus ancien. */
export async function getSageQuotesForClient(sageCode: string): Promise<{ quotes: SageQuoteSummary[]; total: number }> {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("sage_quotes_view")
    .select(HEADER_COLUMNS, { count: "exact" })
    .eq("client_sage_code", sageCode)
    .order("doc_date", { ascending: false, nullsFirst: false })
    .limit(30);
  return { quotes: await summarize(supabase, data ?? []), total: count ?? 0 };
}

/** Recherche par numéro, tous clients confondus (le rapprochement avec le client de la demande est signalé). */
export async function searchSageQuotesByNumber(query: string, sageCode: string | null): Promise<SageQuoteSummary[]> {
  // Le critère sert dans un filtre PostgREST : on n'y laisse que ce qui compose un numéro de pièce.
  const q = query.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
  if (!q) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("sage_quotes_view")
    .select(HEADER_COLUMNS)
    .ilike("sage_piece", `%${q}%`)
    .order("doc_date", { ascending: false, nullsFirst: false })
    .limit(10);
  const summaries = await summarize(supabase, data ?? []);
  const codes = Array.from(new Set((data ?? []).map((h) => h.client_sage_code)));
  const { data: customers } = codes.length ? await supabase.from("sage_customers_view").select("sage_code,name").in("sage_code", codes) : { data: [] };
  const names = new Map((customers ?? []).map((c) => [c.sage_code as string, c.name as string]));
  return summaries.map((s, i) => {
    const code = (data ?? [])[i].client_sage_code as string;
    return { ...s, client_sage_code: code, client_name: names.get(code) ?? null, sameClient: !!sageCode && code === sageCode };
  });
}

/**
 * Devis Sage prêt à préremplir le formulaire, ou une raison de refus. Le devis
 * doit appartenir au client de la demande et ne pas avoir déjà été importé.
 */
export async function getSagePrefill(
  piece: string,
  sageCode: string | null
): Promise<{ prefill: SagePrefill } | { error: string }> {
  const supabase = await createClient();
  const { data: header } = await supabase
    .from("sage_quotes_view")
    .select("sage_piece,client_ref,date_livraison,total_ht,total_ttc,devise_no,client_sage_code")
    .eq("sage_piece", piece)
    .maybeSingle();
  if (!header) return { error: `Le devis Sage ${piece} n'existe plus (transformé, purgé, ou pas encore synchronisé).` };
  if (!sageCode || header.client_sage_code !== sageCode) {
    return { error: `Le devis Sage ${piece} appartient à un autre client (${header.client_sage_code}) que celui de cette demande.` };
  }
  const { data: existing } = await supabase.from("quotes").select("reference").eq("sage_piece", piece).maybeSingle();
  if (existing) return { error: `Le devis Sage ${piece} a déjà été récupéré : ${existing.reference}.` };

  const { data: lines } = await supabase
    .from("sage_quote_lines_view")
    .select("designation,quantity,unit_price,remise_pct,tva_rate,ar_ref,position,line_no")
    .eq("sage_piece", piece)
    .order("position")
    .order("line_no");

  const rates = new Map<number, number>();
  for (const l of lines ?? []) if (l.tva_rate !== null) rates.set(Number(l.tva_rate), (rates.get(Number(l.tva_rate)) ?? 0) + 1);
  const tvaRate = rates.size ? Array.from(rates.entries()).sort((a, b) => b[1] - a[1])[0][0] : null;

  return {
    prefill: {
      sagePiece: header.sage_piece,
      clientRef: header.client_ref,
      dateLivraison: header.date_livraison,
      tvaRate,
      totalHt: Number(header.total_ht),
      totalTtc: Number(header.total_ttc),
      deviseNo: header.devise_no,
      lines: (lines ?? []).map((l) => ({
        description: l.designation,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        remise_pct: Number(l.remise_pct),
        ar_ref: l.ar_ref,
      })),
    },
  };
}

/** Date de la dernière synchronisation des devis Sage (plus récente de toutes les lignes). */
export async function getSageQuotesLastSync(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("sage_quotes_view").select("last_sync_at").order("last_sync_at", { ascending: false }).limit(1).maybeSingle();
  return data?.last_sync_at ?? null;
}
