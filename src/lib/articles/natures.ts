/**
 * Nature, type d'approvisionnement et unité d'un article (migration 0093) :
 * tous les articles — produits finis, matières premières, consommables —
 * partagent la même liste et la même fiche.
 */
export const ARTICLE_NATURES = ["pf", "mp", "consommable"] as const;
export type ArticleNature = (typeof ARTICLE_NATURES)[number];

export const NATURE_LABELS: Record<ArticleNature, string> = {
  pf: "Produit fini",
  mp: "Matière première",
  consommable: "Consommable",
};

export const TYPES_APPRO = ["fabrique", "negoce", "sous_traite", "facon", "service"] as const;
export type TypeAppro = (typeof TYPES_APPRO)[number];

export const TYPE_APPRO_LABELS: Record<TypeAppro, string> = {
  fabrique: "Fabriqué",
  negoce: "Négoce",
  sous_traite: "Sous-traité",
  facon: "Façon",
  service: "Service",
};

export const TYPE_APPRO_HINTS: Record<TypeAppro, string> = {
  fabrique: "Produit dans nos ateliers.",
  negoce: "Acheté et revendu tel quel.",
  sous_traite: "Fabriqué par un tiers pour nous.",
  facon: "Travail sur les articles fournis par le client.",
  service: "Prestation sans article (création de visuel…).",
};

export const UNITES = ["piece", "kg", "g", "m", "l"] as const;
export type Unite = (typeof UNITES)[number];

export const UNITE_LABELS: Record<Unite, string> = { piece: "pièce", kg: "kg", g: "g", m: "m", l: "l" };
