/**
 * Filtres de la liste Articles (ART-A) — l'état complet vit dans l'URL
 * (partageable, rechargeable, bouton Précédent fonctionnel), comme la liste
 * des clients. Une seule liste pour toutes les natures (produits finis,
 * matières premières, consommables — migration 0093). Le catalogue compte
 * quelques centaines d'articles au plus : le filtrage
 * se fait en mémoire, par ce module pur (testé par npm run test:codification).
 */
import { normalizeSearch, searchTerms } from "@/lib/clients/filters";
import { ARTICLE_NATURES, TYPES_APPRO, type ArticleNature, type TypeAppro } from "@/lib/articles/natures";

export const ARTICLE_PAGE_SIZES = [25, 50, 100] as const;
export const ARTICLE_DEFAULT_PAGE_SIZE = 25;

export const ARTICLE_SORTS = ["nom", "code", "categorie", "declinaisons", "stock", "prix"] as const;
export type ArticleSortKey = (typeof ARTICLE_SORTS)[number];

export interface ArticleFilters {
  q: string;
  nature: "" | ArticleNature;
  type: "" | TypeAppro;
  famille: string;
  sousFamille: string;
  categorie: string;
  actif: "oui" | "non" | "tous";
  matiere: string;
  grammage: string;
  couleur: string;
  grille: "" | "avec" | "sans";
  sage: "" | "avec" | "sans";
  tri: ArticleSortKey;
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

export function parseArticleFilters(params: RawParams): ArticleFilters {
  const page = Number.parseInt(one(params, "page"), 10);
  const taille = Number.parseInt(one(params, "taille"), 10);
  return {
    q: one(params, "q").slice(0, 100),
    nature: oneOf(one(params, "nature"), ["", ...ARTICLE_NATURES] as const, ""),
    type: oneOf(one(params, "type"), ["", ...TYPES_APPRO] as const, ""),
    famille: one(params, "famille").slice(0, 40),
    sousFamille: one(params, "sous_famille").slice(0, 40),
    categorie: one(params, "categorie").slice(0, 100),
    actif: oneOf(one(params, "actif"), ["oui", "non", "tous"] as const, "oui"),
    matiere: one(params, "matiere").slice(0, 100),
    grammage: /^\d{1,4}$/.test(one(params, "grammage")) ? one(params, "grammage") : "",
    couleur: one(params, "couleur").slice(0, 100),
    grille: oneOf(one(params, "grille"), ["", "avec", "sans"] as const, ""),
    sage: oneOf(one(params, "sage"), ["", "avec", "sans"] as const, ""),
    tri: oneOf(one(params, "tri"), ARTICLE_SORTS, "nom"),
    ordre: one(params, "ordre") === "desc" ? "desc" : "asc",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    taille: (ARTICLE_PAGE_SIZES as readonly number[]).includes(taille) ? taille : ARTICLE_DEFAULT_PAGE_SIZE,
  };
}

export function articleFiltersToSearchParams(f: ArticleFilters, overrides: Partial<Pick<ArticleFilters, "page">> = {}): URLSearchParams {
  const sp = new URLSearchParams();
  const set = (k: string, v: string | number) => {
    if (v !== "" && v !== undefined && v !== null) sp.set(k, String(v));
  };
  set("q", f.q);
  set("nature", f.nature);
  set("type", f.type);
  set("famille", f.famille);
  set("sous_famille", f.sousFamille);
  set("categorie", f.categorie);
  if (f.actif !== "oui") set("actif", f.actif);
  set("matiere", f.matiere);
  set("grammage", f.grammage);
  set("couleur", f.couleur);
  set("grille", f.grille);
  set("sage", f.sage);
  if (f.tri !== "nom") set("tri", f.tri);
  if (f.ordre !== "asc") set("ordre", f.ordre);
  if (f.taille !== ARTICLE_DEFAULT_PAGE_SIZE) set("taille", f.taille);
  const page = overrides.page ?? f.page;
  if (page > 1) set("page", page);
  return sp;
}

/** Filtres actifs hors valeurs par défaut. */
export function activeArticleFilterCount(f: ArticleFilters): number {
  return [f.q, f.nature, f.type, f.famille, f.sousFamille, f.categorie, f.actif !== "oui" ? "x" : "", f.matiere, f.grammage, f.couleur, f.grille, f.sage].filter(
    Boolean
  ).length;
}

/** Une ligne de la liste des articles, telle que la page la construit. */
export interface ArticleRow {
  id: string;
  code: string | null;
  name: string;
  nature: ArticleNature;
  typeAppro: TypeAppro;
  familleId: string | null;
  sousFamilleId: string | null;
  /** « Famille › Sous-famille », pour l'affichage. */
  famille: string | null;
  unite: string;
  category: string | null;
  active: boolean;
  matiere: string | null;
  /** Grammages autorisés (textiles du modèle). */
  grammages: number[];
  /** Identifiants des couleurs déclarées pour le modèle. */
  couleurIds: string[];
  /** Le modèle a-t-il une grille de prix de revient ? (null : non visible pour ce rôle) */
  grille: boolean | null;
  /** Une référence Sage est-elle renseignée (modèle ou déclinaison) ? */
  sage: boolean;
  declinaisons: number;
  stockDisponible: number | null;
  prixAPartirDe: number | null;
  vignetteUrl: string | null;
  /** Texte de recherche normalisé (nom, code, catégorie, matière, références). */
  searchText: string;
}

/** Texte de recherche normalisé d'une ligne (sans accents ni casse). */
export function articleSearchText(parts: (string | null | undefined)[]): string {
  return normalizeSearch(parts.filter(Boolean).join(" "));
}

const SORT_VALUE: Record<ArticleSortKey, (r: ArticleRow) => string | number | null> = {
  nom: (r) => normalizeSearch(r.name),
  code: (r) => r.code,
  categorie: (r) => (r.category ? normalizeSearch(r.category) : null),
  declinaisons: (r) => r.declinaisons,
  stock: (r) => r.stockDisponible,
  prix: (r) => r.prixAPartirDe,
};

/** Recherche (chaque mot doit être présent), filtres, tri stable puis par nom. */
export function applyArticleFilters(rows: ArticleRow[], f: ArticleFilters): ArticleRow[] {
  const terms = searchTerms(f.q);
  const filtered = rows.filter((r) => {
    if (terms.some((t) => !r.searchText.includes(t))) return false;
    if (f.nature && r.nature !== f.nature) return false;
    if (f.type && r.typeAppro !== f.type) return false;
    if (f.famille && r.familleId !== f.famille) return false;
    if (f.sousFamille && r.sousFamilleId !== f.sousFamille) return false;
    if (f.categorie && (r.category ?? "") !== f.categorie) return false;
    if (f.actif === "oui" && !r.active) return false;
    if (f.actif === "non" && r.active) return false;
    if (f.matiere && (r.matiere ?? "") !== f.matiere) return false;
    if (f.grammage && !r.grammages.includes(Number(f.grammage))) return false;
    if (f.couleur && !r.couleurIds.includes(f.couleur)) return false;
    if (f.grille === "avec" && r.grille !== true) return false;
    if (f.grille === "sans" && r.grille !== false) return false;
    if (f.sage === "avec" && !r.sage) return false;
    if (f.sage === "sans" && r.sage) return false;
    return true;
  });
  const dir = f.ordre === "asc" ? 1 : -1;
  const value = SORT_VALUE[f.tri];
  return filtered.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // Valeurs absentes toujours en fin de liste, quel que soit l'ordre.
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return (va < vb ? -1 : 1) * dir;
    return normalizeSearch(a.name) < normalizeSearch(b.name) ? -1 : 1;
  });
}

export function paginate<T>(rows: T[], page: number, taille: number): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / taille));
  const p = Math.min(Math.max(page, 1), totalPages);
  return { rows: rows.slice((p - 1) * taille, p * taille), page: p, totalPages };
}
