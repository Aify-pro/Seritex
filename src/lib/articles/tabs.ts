import type { ArticleNature } from "@/lib/articles/natures";

/**
 * Onglets de la fiche article (`/articles/[id]/<onglet>`), un chargement par
 * onglet. `costsOnly` : onglet réservé à qui voit les coûts (Direction et
 * administrateur, droit `tarification/view` — A2). `natures` : onglet propre
 * à certaines natures (fiche unique, migration 0093) ; absent = toutes.
 */
export interface ArticleTabDef {
  slug: string;
  label: string;
  costsOnly?: boolean;
  natures?: ArticleNature[];
}

/** Natures vendues et stockées : tout sauf le semi-fini (0143), qui n'a ni déclinaison, ni vente, ni stock Sage. */
const ARTICLES_VENDUS: ArticleNature[] = ["pf", "mp", "consommable"];

export const ARTICLE_DETAIL_TABS: ArticleTabDef[] = [
  { slug: "general", label: "Général" },
  { slug: "technique", label: "Technique", natures: ["pf", "semi_fini"] },
  { slug: "declinaisons", label: "Déclinaisons", natures: ARTICLES_VENDUS },
  { slug: "fabrication", label: "Fabrication", natures: ["pf"] },
  { slug: "ventes", label: "Ventes", natures: ARTICLES_VENDUS },
  { slug: "stock", label: "Stock", natures: ARTICLES_VENDUS },
  { slug: "medias", label: "Médias & e-shop", natures: ARTICLES_VENDUS },
  { slug: "prix-de-revient", label: "Prix de revient", costsOnly: true, natures: ARTICLES_VENDUS },
];
