/**
 * Filtres du module Clients — partagés par la page liste et l'export CSV pour
 * que « ce que je vois » et « ce que j'exporte » soient toujours identiques.
 *
 * L'état complet des filtres vit dans l'URL (partageable, rechargeable, bouton
 * Précédent fonctionnel). Toutes les valeurs sont validées ici : un paramètre
 * inconnu ou mal formé retombe sur sa valeur par défaut, jamais sur une
 * requête invalide. La requête cible la vue `companies_list` (migration 0060).
 */

export const CLIENT_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const CLIENT_STATUTS = ["actif", "sommeil", "archive", "tous"] as const;
export type ClientStatut = (typeof CLIENT_STATUTS)[number];

/** Colonnes de `companies_list` sur lesquelles on autorise le tri. */
export const CLIENT_SORTS = {
  nom: "name",
  code: "sage_code",
  ville: "ville",
  contacts: "contact_count",
  activite: "last_activity_at",
  creation: "sage_created_at",
} as const;
export type ClientSortKey = keyof typeof CLIENT_SORTS;

export interface ClientFilters {
  q: string;
  statut: ClientStatut;
  origine: "" | "sage" | "manuel";
  type: "" | "client" | "prospect";
  famille: string;
  zone: string;
  typologie: string;
  ville: string;
  pays: string;
  representant: string;
  contacts: "" | "avec" | "sans";
  portail: "" | "avec" | "sans";
  activite: "" | "en_cours" | "aucune";
  tri: ClientSortKey;
  ordre: "asc" | "desc";
  page: number;
  taille: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function one(params: RawParams, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseClientFilters(params: RawParams): ClientFilters {
  const page = Number.parseInt(one(params, "page"), 10);
  const taille = Number.parseInt(one(params, "taille"), 10);
  const tri = oneOf(one(params, "tri"), Object.keys(CLIENT_SORTS) as ClientSortKey[], "nom");

  return {
    q: one(params, "q").slice(0, 100),
    statut: oneOf(one(params, "statut"), CLIENT_STATUTS, "actif"),
    origine: oneOf(one(params, "origine"), ["", "sage", "manuel"] as const, ""),
    type: oneOf(one(params, "type"), ["", "client", "prospect"] as const, ""),
    famille: one(params, "famille").slice(0, 100),
    zone: one(params, "zone").slice(0, 100),
    typologie: one(params, "typologie").slice(0, 100),
    ville: one(params, "ville").slice(0, 100),
    pays: one(params, "pays").slice(0, 100),
    representant: /^\d{1,6}$/.test(one(params, "representant")) ? one(params, "representant") : "",
    contacts: oneOf(one(params, "contacts"), ["", "avec", "sans"] as const, ""),
    portail: oneOf(one(params, "portail"), ["", "avec", "sans"] as const, ""),
    activite: oneOf(one(params, "activite"), ["", "en_cours", "aucune"] as const, ""),
    tri,
    ordre: one(params, "ordre") === "desc" ? "desc" : one(params, "ordre") === "asc" ? "asc" : tri === "activite" || tri === "creation" ? "desc" : "asc",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    taille: (CLIENT_PAGE_SIZES as readonly number[]).includes(taille) ? taille : DEFAULT_PAGE_SIZE,
  };
}

/** Minuscules et sans accents — même normalisation que `seritex_norm` en base. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Échappe les jokers LIKE pour qu'une saisie comme « 50% » soit cherchée telle quelle. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Chaque mot saisi doit être présent (ET) : « ivoire abidjan » restreint, il n'élargit pas. */
export function searchTerms(q: string): string[] {
  return normalizeSearch(q)
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

// Le constructeur de requêtes Supabase est générique et non typé ici (pas de
// types de base générés) : on ne fige que les méthodes de filtre utilisées.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filterable = Record<"ilike" | "eq" | "gt" | "order", (...args: any[]) => any>;

/**
 * Vue simplifiée du constructeur de requêtes, pour les appelants qui paginent
 * (l'export CSV) : évite d'instancier les types génériques profonds de supabase-js.
 */
export type ClientQuery = Filterable & {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; count?: number | null; error: { message: string; code?: string } | null }>;
};

export function applyClientFilters<Q extends Filterable>(query: Q, f: ClientFilters): Q {
  let q = query;

  for (const term of searchTerms(f.q)) q = q.ilike("search_text", `%${escapeLike(term)}%`) as Q;

  if (f.statut !== "tous") q = q.eq("statut", f.statut) as Q;
  if (f.origine) q = q.eq("origin", f.origine) as Q;
  if (f.type) q = q.eq("is_prospect", f.type === "prospect") as Q;
  if (f.famille) q = q.eq("famille", f.famille) as Q;
  if (f.zone) q = q.eq("zone", f.zone) as Q;
  if (f.typologie) q = q.eq("typologie", f.typologie) as Q;
  if (f.ville) q = q.eq("ville", f.ville) as Q;
  if (f.pays) q = q.eq("pays", f.pays) as Q;
  if (f.representant) q = q.eq("representant_no", Number(f.representant)) as Q;

  if (f.contacts === "avec") q = q.gt("contact_count", 0) as Q;
  if (f.contacts === "sans") q = q.eq("contact_count", 0) as Q;
  if (f.portail === "avec") q = q.gt("portal_account_count", 0) as Q;
  if (f.portail === "sans") q = q.eq("portal_account_count", 0) as Q;
  if (f.activite === "en_cours") q = q.gt("open_activity_count", 0) as Q;
  if (f.activite === "aucune") q = q.eq("open_activity_count", 0) as Q;

  // Tri principal puis nom (ordre stable, pagination sans doublons ni trous).
  q = q.order(CLIENT_SORTS[f.tri], { ascending: f.ordre === "asc", nullsFirst: false }) as Q;
  if (f.tri !== "nom") q = q.order("name", { ascending: true }) as Q;
  return q;
}

/** Filtres actifs hors valeurs par défaut — pour le badge « N filtres » et « Réinitialiser ». */
export function activeFilterCount(f: ClientFilters): number {
  return [
    f.q,
    f.statut !== "actif" ? f.statut : "",
    f.origine,
    f.type,
    f.famille,
    f.zone,
    f.typologie,
    f.ville,
    f.pays,
    f.representant,
    f.contacts,
    f.portail,
    f.activite,
  ].filter(Boolean).length;
}

/** Reconstruit la query string (sans les valeurs par défaut) pour les liens de pagination / d'export. */
export function filtersToSearchParams(f: ClientFilters, overrides: Partial<Record<"page", number>> = {}): URLSearchParams {
  const sp = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  };
  set("q", f.q);
  if (f.statut !== "actif") set("statut", f.statut);
  set("origine", f.origine);
  set("type", f.type);
  set("famille", f.famille);
  set("zone", f.zone);
  set("typologie", f.typologie);
  set("ville", f.ville);
  set("pays", f.pays);
  set("representant", f.representant);
  set("contacts", f.contacts);
  set("portail", f.portail);
  set("activite", f.activite);
  if (f.tri !== "nom") set("tri", f.tri);
  const defaultOrdre = f.tri === "activite" || f.tri === "creation" ? "desc" : "asc";
  if (f.ordre !== defaultOrdre) set("ordre", f.ordre);
  if (f.taille !== DEFAULT_PAGE_SIZE) set("taille", f.taille);
  const page = overrides.page ?? f.page;
  if (page > 1) set("page", page);
  return sp;
}

export interface FilterOption {
  value: string;
  label?: string;
  count: number;
}

export interface ClientFilterOptions {
  familles: FilterOption[];
  zones: FilterOption[];
  typologies: FilterOption[];
  villes: FilterOption[];
  pays: FilterOption[];
  representants: FilterOption[];
}

export const EMPTY_FILTER_OPTIONS: ClientFilterOptions = {
  familles: [],
  zones: [],
  typologies: [],
  villes: [],
  pays: [],
  representants: [],
};
