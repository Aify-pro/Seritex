import { NATURES_VISITE, SOURCES_VISITE } from "./constantes";
import { type Filterable, dateOf, escapeLike, listOf, one, oneOf, pageOf, uuidOf, type RawParams } from "@/lib/filters/params";
import { searchTerms } from "@/lib/clients/filters";

/** Filtres du journal des visites (Prospection) — lus dans l'URL, appliqués à la vue `visites_list` (migration 0134). */

export const VISITE_NATURES = Object.keys(NATURES_VISITE) as (keyof typeof NATURES_VISITE)[];
export const VISITE_SOURCES = Object.keys(SOURCES_VISITE) as (keyof typeof SOURCES_VISITE)[];

export const VISITE_SORTS = {
  date: { column: "jour", label: "Date de la visite", defaultOrder: "desc" },
  client: { column: "tiers", label: "Client / prospect", defaultOrder: "asc" },
  commercial: { column: "auteur", label: "Commercial", defaultOrder: "asc" },
} as const;
export type VisiteSortKey = keyof typeof VISITE_SORTS;

export interface VisiteFilters {
  q: string;
  nature: (keyof typeof NATURES_VISITE)[];
  source: "" | keyof typeof SOURCES_VISITE;
  commercial: string;
  rattachement: "" | "a_rattacher" | "rattachee";
  du: string;
  au: string;
  tri: VisiteSortKey;
  ordre: "asc" | "desc";
  page: number;
  taille: number;
}

export function parseVisiteFilters(params: RawParams): VisiteFilters {
  const tri = oneOf(one(params, "tri"), Object.keys(VISITE_SORTS) as VisiteSortKey[], "date");
  return {
    q: one(params, "q").slice(0, 100),
    nature: listOf(params, "nature", VISITE_NATURES),
    source: oneOf(one(params, "source"), ["", ...VISITE_SOURCES] as ("" | keyof typeof SOURCES_VISITE)[], ""),
    commercial: uuidOf(params, "commercial"),
    rattachement: oneOf(one(params, "rattachement"), ["", "a_rattacher", "rattachee"] as const, ""),
    du: dateOf(params, "du"),
    au: dateOf(params, "au"),
    tri,
    ordre: oneOf(one(params, "ordre"), ["asc", "desc"] as const, VISITE_SORTS[tri].defaultOrder),
    ...pageOf(params),
  };
}

export function applyVisiteFilters<Q extends Filterable>(query: Q, f: VisiteFilters): Q {
  let q = query;
  for (const term of searchTerms(f.q)) q = q.ilike("search_text", `%${escapeLike(term)}%`) as Q;
  if (f.nature.length > 0) q = q.in("nature", f.nature) as Q;
  if (f.source) q = q.eq("source", f.source) as Q;
  if (f.commercial) q = q.eq("app_user_id", f.commercial) as Q;
  if (f.rattachement) q = q.eq("a_rattacher", f.rattachement === "a_rattacher") as Q;
  if (f.du) q = q.gte("jour", f.du) as Q;
  if (f.au) q = q.lte("jour", f.au) as Q;

  q = q.order(VISITE_SORTS[f.tri].column, { ascending: f.ordre === "asc", nullsFirst: false }) as Q;
  if (f.tri !== "date") q = q.order("jour", { ascending: false }) as Q;
  return q.order("created_at", { ascending: false }) as Q;
}
