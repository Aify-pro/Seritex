/**
 * États de suivi montrés au client (vues client_commandes / client_livraisons, migration 0132).
 * Les étapes internes — brouillon, validation comptable, refus d'ODF… — s'y présentent comme
 * « en préparation » : le client voit l'avancement, pas la cuisine interne.
 */

export const ETATS_COMMANDE = ["en_preparation", "en_fabrication", "terminee", "annulee"] as const;
export type EtatCommande = (typeof ETATS_COMMANDE)[number];

export const ETAT_COMMANDE_LABELS: Record<EtatCommande, string> = {
  en_preparation: "En préparation",
  en_fabrication: "En fabrication",
  terminee: "Terminée",
  annulee: "Annulée",
};

export const ETATS_LIVRAISON = [
  "en_preparation",
  "planifiee",
  "prete_a_enlever",
  "en_route",
  "livree",
  "enlevee",
  "reception_confirmee",
  "a_replanifier",
  "litige",
] as const;
export type EtatLivraison = (typeof ETATS_LIVRAISON)[number];

export const ETAT_LIVRAISON_LABELS: Record<EtatLivraison, string> = {
  en_preparation: "En préparation",
  planifiee: "Planifiée",
  prete_a_enlever: "Prête à enlever",
  en_route: "En route",
  livree: "Livrée",
  enlevee: "Enlevée",
  reception_confirmee: "Réception confirmée",
  a_replanifier: "À replanifier",
  litige: "Litige en cours",
};
