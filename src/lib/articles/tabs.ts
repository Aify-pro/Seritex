/**
 * Onglets de la fiche article (`/articles/[id]/<onglet>`), un chargement par
 * onglet. `costsOnly` : onglet réservé à qui voit les coûts (Direction et
 * administrateur, droit `tarification/view` — A2).
 */
export interface ArticleTabDef {
  slug: string;
  label: string;
  costsOnly?: boolean;
}

export const ARTICLE_DETAIL_TABS: ArticleTabDef[] = [
  { slug: "general", label: "Général" },
  { slug: "technique", label: "Technique" },
];
