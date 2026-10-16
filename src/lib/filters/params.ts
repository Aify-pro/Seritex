/**
 * Lecture sûre des paramètres d'URL des listes (demandes, devis, visites…) :
 * toute valeur inconnue ou mal formée retombe sur sa valeur par défaut, jamais
 * sur une requête invalide. Même esprit que `lib/clients/filters.ts`.
 */

export type RawParams = Record<string, string | string[] | undefined>;

export function one(params: RawParams, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Liste de valeurs séparées par des virgules, limitée aux valeurs autorisées (ex. plusieurs statuts). */
export function listOf<T extends string>(params: RawParams, key: string, allowed: readonly T[]): T[] {
  const picked = one(params, key)
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return [...new Set(picked)];
}

/** Date AAAA-MM-JJ valide, sinon chaîne vide. */
export function dateOf(params: RawParams, key: string): string {
  const v = one(params, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? "" : v;
}

export function positiveInt(value: string, max = 10_000_000): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null;
}

export function uuidOf(params: RawParams, key: string): string {
  const v = one(params, key);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : "";
}

export const PAGE_SIZES = [25, 50, 100] as const;

export function pageOf(params: RawParams): { page: number; taille: number } {
  const page = Number.parseInt(one(params, "page"), 10);
  const taille = Number.parseInt(one(params, "taille"), 10);
  return {
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    taille: (PAGE_SIZES as readonly number[]).includes(taille) ? taille : PAGE_SIZES[0],
  };
}

/** Échappe les jokers LIKE pour qu'une saisie comme « 50% » soit cherchée telle quelle. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Query string canonique d'une liste : sans pagination, clés triées, valeurs vides retirées. */
export function canonicalParams(input: string | URLSearchParams): string {
  const sp = new URLSearchParams(typeof input === "string" ? input.replace(/^\?/, "") : input);
  sp.delete("page");
  const entries = [...sp.entries()].filter(([, v]) => v !== "").sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

// Le constructeur de requêtes Supabase est générique et non typé ici (pas de types
// de base générés) : on ne fige que les méthodes de filtre utilisées par les listes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Filterable = Record<"ilike" | "eq" | "gt" | "gte" | "lte" | "lt" | "in" | "is" | "order", (...args: any[]) => any>;

/** Requête de liste prête à paginer (`range`) — évite d'instancier les types génériques profonds de supabase-js. */
export type ListQuery = Filterable & {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; count?: number | null; error: { message: string; code?: string } | null }>;
};
