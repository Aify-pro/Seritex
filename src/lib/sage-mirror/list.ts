/**
 * Listes miroir Sage (Paramètres > Intégration Sage) : recherche, filtres et
 * pagination pilotés par l'URL, évalués côté base. Sans cela, la liste est
 * tronquée en silence à 1000 lignes (plafond PostgREST) et rien ne permet de
 * retrouver une ligne au-delà. Toute valeur d'URL est validée ici : un
 * paramètre mal formé retombe sur sa valeur par défaut.
 */

export const MIRROR_PAGE_SIZE = 50;

type RawParams = Record<string, string | string[] | undefined>;

export interface MirrorListParams {
  q: string;
  page: number;
  /** Valeurs des filtres déclarés (clé absente ou vide = pas de filtre). */
  filters: Record<string, string>;
}

function one(params: RawParams, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function parseMirrorParams(params: RawParams, filterKeys: readonly string[] = []): MirrorListParams {
  const page = Number.parseInt(one(params, "page"), 10);
  const filters: Record<string, string> = {};
  for (const key of filterKeys) filters[key] = one(params, key).slice(0, 100);
  return {
    q: one(params, "q").slice(0, 100),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    filters,
  };
}

/**
 * Motif de recherche sûr pour un filtre `.or("col.ilike.%…%,…")` PostgREST :
 * les caractères qui structurent la syntaxe du filtre (virgule, parenthèses,
 * guillemet, antislash) et les jokers sont retirés plutôt qu'échappés.
 */
export function searchPattern(q: string): string | null {
  const cleaned = q.replace(/[,()"\\%*]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? `%${cleaned}%` : null;
}

export function orIlike(columns: readonly string[], q: string): string | null {
  const pattern = searchPattern(q);
  return pattern ? columns.map((c) => `${c}.ilike.${pattern}`).join(",") : null;
}

export function pageRange(page: number, size: number = MIRROR_PAGE_SIZE): [number, number] {
  return [(page - 1) * size, page * size - 1];
}

export function activeMirrorFilterCount(p: MirrorListParams): number {
  return (p.q ? 1 : 0) + Object.values(p.filters).filter(Boolean).length;
}
