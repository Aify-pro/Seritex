/** Rôles de base qui ouvrent l'écran du service livraison ; le droit `livraisons/view` décide ensuite. */
export const DELIVERY_ROLES = ["administrateur", "responsable_livraison", "comptabilite", "commercial", "responsable_production"] as const;

/** Rôles qui préparent, planifient et suivent les expéditions (contrôlé aussi en base). */
export const DELIVERY_MANAGER_ROLES = ["administrateur", "responsable_livraison"] as const;
