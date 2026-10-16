import { type Filterable, dateOf, escapeLike, listOf, one, oneOf, pageOf, uuidOf, type RawParams } from "@/lib/filters/params";
import { searchTerms } from "@/lib/clients/filters";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/lib/types/domain";

/**
 * Filtres de la liste des demandes (module Demandes et Demandes graphiques) —
 * lus dans l'URL, appliqués à la vue `requests_list` (migration 0134).
 */

export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[];

export const REQUEST_KINDS = {
  client: "Client",
  a_rattacher: "Client à rattacher (site web)",
  stock: "Pour le stock",
} as const;

export const REQUEST_SOURCES = {
  portail: "Portail client",
  site: "Site web",
  email: "E-mail",
  whatsapp: "WhatsApp",
  manuel: "Saisie manuelle",
} as const;

export const REQUEST_SORTS = {
  date: { column: "created_at", label: "Date de création", defaultOrder: "desc" },
  reference: { column: "reference", label: "Référence", defaultOrder: "desc" },
  client: { column: "company_name", label: "Client", defaultOrder: "asc" },
  statut: { column: "status", label: "Statut", defaultOrder: "asc" },
  mise_a_jour: { column: "updated_at", label: "Dernière mise à jour", defaultOrder: "desc" },
} as const;
export type RequestSortKey = keyof typeof REQUEST_SORTS;

export interface RequestFilters {
  q: string;
  statut: RequestStatus[];
  kind: "" | keyof typeof REQUEST_KINDS;
  source: "" | keyof typeof REQUEST_SOURCES;
  /** Identifiant d'un commercial, ou « aucun » (non assignée). */
  commercial: string;
  graphique: "" | "oui" | "non";
  devis: "" | "avec" | "sans";
  du: string;
  au: string;
  tri: RequestSortKey;
  ordre: "asc" | "desc";
  page: number;
  taille: number;
}

export function parseRequestFilters(params: RawParams): RequestFilters {
  const tri = oneOf(one(params, "tri"), Object.keys(REQUEST_SORTS) as RequestSortKey[], "date");
  const ordre = oneOf(one(params, "ordre"), ["asc", "desc"] as const, REQUEST_SORTS[tri].defaultOrder);
  return {
    q: one(params, "q").slice(0, 100),
    statut: listOf(params, "statut", REQUEST_STATUSES),
    kind: oneOf(one(params, "kind"), ["", ...Object.keys(REQUEST_KINDS)] as ("" | keyof typeof REQUEST_KINDS)[], ""),
    source: oneOf(one(params, "source"), ["", ...Object.keys(REQUEST_SOURCES)] as ("" | keyof typeof REQUEST_SOURCES)[], ""),
    commercial: one(params, "commercial") === "aucun" ? "aucun" : uuidOf(params, "commercial"),
    graphique: oneOf(one(params, "graphique"), ["", "oui", "non"] as const, ""),
    devis: oneOf(one(params, "devis"), ["", "avec", "sans"] as const, ""),
    du: dateOf(params, "du"),
    au: dateOf(params, "au"),
    tri,
    ordre,
    ...pageOf(params),
  };
}


function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `forceGraphics` : module Demandes graphiques, qui ne montre que les demandes à visuel. */
export function applyRequestFilters<Q extends Filterable>(query: Q, f: RequestFilters, opts: { forceGraphics?: boolean } = {}): Q {
  let q = query;
  for (const term of searchTerms(f.q)) q = q.ilike("search_text", `%${escapeLike(term)}%`) as Q;
  if (f.statut.length > 0) q = q.in("status", f.statut) as Q;
  if (f.kind) q = q.eq("kind", f.kind) as Q;
  if (f.source) q = q.eq("source", f.source) as Q;
  if (f.commercial === "aucun") q = q.is("assigned_commercial_id", null) as Q;
  else if (f.commercial) q = q.eq("assigned_commercial_id", f.commercial) as Q;
  if (opts.forceGraphics) q = q.eq("needs_graphics", true) as Q;
  else if (f.graphique) q = q.eq("needs_graphics", f.graphique === "oui") as Q;
  if (f.devis === "avec") q = q.gt("quote_count", 0) as Q;
  if (f.devis === "sans") q = q.eq("quote_count", 0) as Q;
  if (f.du) q = q.gte("created_at", f.du) as Q;
  if (f.au) q = q.lt("created_at", nextDay(f.au)) as Q;

  const sort = REQUEST_SORTS[f.tri];
  q = q.order(sort.column, { ascending: f.ordre === "asc", nullsFirst: false }) as Q;
  if (f.tri !== "reference") q = q.order("reference", { ascending: false }) as Q;
  return q;
}
