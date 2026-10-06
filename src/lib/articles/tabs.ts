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

export const ARTICLE_DETAIL_TABS: ArticleTabDef[] = [
  { slug: "general", label: "Général" },
  { slug: "technique", label: "Technique", natures: ["pf"] },
  { slug: "declinaisons", label: "Déclinaisons" },
  { slug: "fabrication", label: "Fabrication", natures: ["pf"] },
  { slug: "ventes", label: "Ventes" },
  { slug: "stock", label: "Stock", natures: ["pf"] },
  { slug: "rouleaux", label: "Rouleaux", natures: ["mp"] },
  { slug: "medias", label: "Médias & e-shop" },
  { slug: "prix-de-revient", label: "Prix de revient", costsOnly: true },
];
