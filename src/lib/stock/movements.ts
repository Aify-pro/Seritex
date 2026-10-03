/**
 * Libellés des mouvements de stock (stock_movements.type) — une seule liste
 * pour tous les écrans et l'export. Les types « semi-fini » et « fini » sont
 * obsolètes depuis SF-1 (plus générés), gardés pour l'historique.
 */
export const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  sortie_mp: "Sortie MP",
  retour_mp: "Retour MP",
  sortie_pf: "Sortie PF (prélèvement)",
  entree_pf: "Entrée PF vierge",
  entree_pf_personnalise: "Entrée PF personnalisé",
  entree_2e_choix: "Entrée 2e choix",
  sortie_pf_bl: "Sortie PF (bon de livraison)",
  entree_semi_fini: "Entrée semi-fini (obsolète)",
  sortie_semi_fini: "Sortie semi-fini (obsolète)",
  entree_fini: "Entrée fini (obsolète)",
};

/** Sens du mouvement pour Sage : +1 entrée en stock, −1 sortie. */
export function movementSign(type: string): 1 | -1 {
  return ["retour_mp", "entree_pf", "entree_pf_personnalise", "entree_2e_choix", "entree_semi_fini", "entree_fini"].includes(type) ? 1 : -1;
}

/** Nature du stock touchée par le mouvement (MP, PF, consommable) — dépôt Sage pré-rempli à l'export. */
export function movementNature(type: string): "mp" | "pf" | "consommable" {
  if (type === "sortie_mp" || type === "retour_mp") return "mp";
  if (type === "sortie_consommable") return "consommable";
  return "pf";
}
