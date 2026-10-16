import { type Filterable, dateOf, escapeLike, listOf, one, oneOf, pageOf, positiveInt, uuidOf, type RawParams } from "@/lib/filters/params";
import { searchTerms } from "@/lib/clients/filters";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/types/domain";

/** Filtres de la liste des devis — lus dans l'URL, appliqués à la vue `quotes_list` (migration 0134). */

export const QUOTE_STATUSES = Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[];

export const QUOTE_SORTS = {
  date: { column: "created_at", label: "Date de création", defaultOrder: "desc" },
  reference: { column: "reference", label: "Référence", defaultOrder: "desc" },
  client: { column: "company_name", label: "Client", defaultOrder: "asc" },
  montant: { column: "total_amount", label: "Montant", defaultOrder: "desc" },
  validite: { column: "valid_until", label: "Fin de validité", defaultOrder: "asc" },
} as const;
export type QuoteSortKey = keyof typeof QUOTE_SORTS;

export const QUOTE_VALIDITES = {
  depassee: "Validité dépassée",
  bientot: "Expire sous 7 jours",
  valide: "Encore valide",
} as const;

export interface QuoteFilters {
  q: string;
  statut: QuoteStatus[];
  validite: "" | keyof typeof QUOTE_VALIDITES;
  createur: string;
  du: string;
  au: string;
  min: string;
  max: string;
  tri: QuoteSortKey;
  ordre: "asc" | "desc";
  page: number;
  taille: number;
}

export function parseQuoteFilters(params: RawParams): QuoteFilters {
  const tri = oneOf(one(params, "tri"), Object.keys(QUOTE_SORTS) as QuoteSortKey[], "date");
  const min = positiveInt(one(params, "min"));
  const max = positiveInt(one(params, "max"));
  return {
    q: one(params, "q").slice(0, 100),
    statut: listOf(params, "statut", QUOTE_STATUSES),
    validite: oneOf(one(params, "validite"), ["", ...Object.keys(QUOTE_VALIDITES)] as ("" | keyof typeof QUOTE_VALIDITES)[], ""),
    createur: uuidOf(params, "createur"),
    du: dateOf(params, "du"),
    au: dateOf(params, "au"),
    min: min === null ? "" : String(min),
    max: max === null ? "" : String(max),
    tri,
    ordre: oneOf(one(params, "ordre"), ["asc", "desc"] as const, QUOTE_SORTS[tri].defaultOrder),
    ...pageOf(params),
  };
}


function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `today` : date du jour (AAAA-MM-JJ, fuseau d'Abidjan) pour les critères de validité. */
export function applyQuoteFilters<Q extends Filterable>(query: Q, f: QuoteFilters, today: string): Q {
  let q = query;
  for (const term of searchTerms(f.q)) q = q.ilike("search_text", `%${escapeLike(term)}%`) as Q;
  if (f.statut.length > 0) q = q.in("status", f.statut) as Q;
  if (f.createur) q = q.eq("created_by", f.createur) as Q;
  if (f.du) q = q.gte("created_at", f.du) as Q;
  if (f.au) q = q.lt("created_at", addDays(f.au, 1)) as Q;
  if (f.min) q = q.gte("total_amount", Number(f.min)) as Q;
  if (f.max) q = q.lte("total_amount", Number(f.max)) as Q;
  if (f.validite === "depassee") q = q.lt("valid_until", today) as Q;
  if (f.validite === "bientot") q = q.gte("valid_until", today).lte("valid_until", addDays(today, 7)) as Q;
  if (f.validite === "valide") q = q.gte("valid_until", today) as Q;

  const sort = QUOTE_SORTS[f.tri];
  q = q.order(sort.column, { ascending: f.ordre === "asc", nullsFirst: false }) as Q;
  if (f.tri !== "reference") q = q.order("reference", { ascending: false }) as Q;
  return q;
}
