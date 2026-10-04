/**
 * Statuts d'une expédition (LIV-1) — miroir des transitions contrôlées par la
 * base (prepare_shipment, validate_shipment_accounting, plan_shipment,
 * mark_ready_for_pickup, set_shipment_status : migration 0078). La base fait
 * autorité ; ce module sert aux écrans (boutons proposés) et au banc de test
 * `npm run test:livraison`.
 *
 *   a_preparer (auto) → preparee (BL numéroté)
 *     → validee_compta (mention de règlement, bloquant)
 *     → planifiee (livreur, véhicule, date)   | prete_a_enlever (retrait)
 *     → en_route                              |
 *     → livree                                | enlevee (signature sur le BL)
 *     → reception_confirmee (client)
 *   Écarts : echec (motif → re-planification) · annulee · litige
 */

export const SHIPMENT_STATUSES = [
  "a_preparer",
  "preparee",
  "validee_compta",
  "planifiee",
  "prete_a_enlever",
  "en_route",
  "livree",
  "enlevee",
  "reception_confirmee",
  "echec",
  "annulee",
  "litige",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  a_preparer: "À préparer",
  preparee: "Préparée",
  validee_compta: "Validée (compta)",
  planifiee: "Planifiée",
  prete_a_enlever: "Prête à enlever",
  en_route: "En route",
  livree: "Livrée",
  enlevee: "Enlevée",
  reception_confirmee: "Réception confirmée",
  echec: "Échec",
  annulee: "Annulée",
  litige: "Litige",
};

export type ShipmentMode = "livraison" | "retrait";
export type Actor = "service" | "compta" | "livreur" | "client";

export interface Transition {
  to: ShipmentStatus;
  by: Actor[];
  /** Mode de l'expédition requis, s'il y en a un. */
  mode?: ShipmentMode;
}

/** Transitions autorisées depuis chaque statut. */
export const TRANSITIONS: Record<ShipmentStatus, Transition[]> = {
  a_preparer: [
    { to: "preparee", by: ["service"] },
    { to: "annulee", by: ["service"] },
  ],
  preparee: [
    { to: "preparee", by: ["service"] },
    { to: "validee_compta", by: ["compta"] },
    { to: "annulee", by: ["service"] },
  ],
  validee_compta: [
    { to: "planifiee", by: ["service"], mode: "livraison" },
    { to: "prete_a_enlever", by: ["service"], mode: "retrait" },
    { to: "annulee", by: ["service"] },
  ],
  planifiee: [
    { to: "planifiee", by: ["service"], mode: "livraison" },
    { to: "en_route", by: ["service", "livreur"] },
    { to: "annulee", by: ["service"] },
  ],
  prete_a_enlever: [
    { to: "enlevee", by: ["service"] },
    { to: "annulee", by: ["service"] },
  ],
  en_route: [
    { to: "livree", by: ["service", "livreur"] },
    { to: "echec", by: ["service", "livreur"] },
  ],
  echec: [
    { to: "planifiee", by: ["service"], mode: "livraison" },
    { to: "annulee", by: ["service"] },
  ],
  livree: [
    { to: "reception_confirmee", by: ["client"] },
    { to: "litige", by: ["service", "client"] },
  ],
  enlevee: [
    { to: "reception_confirmee", by: ["client"] },
    { to: "litige", by: ["service", "client"] },
  ],
  reception_confirmee: [{ to: "litige", by: ["service", "client"] }],
  annulee: [],
  litige: [],
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus, by: Actor, mode: ShipmentMode): boolean {
  return TRANSITIONS[from].some((t) => t.to === to && t.by.includes(by) && (!t.mode || t.mode === mode));
}

/** Plus aucune pièce ne peut partir sans validation comptable (L3). */
export function requiresAccountingBefore(to: ShipmentStatus): boolean {
  return ["planifiee", "prete_a_enlever", "en_route", "livree", "enlevee"].includes(to);
}

/** Statuts où la marchandise a quitté Seritex (sortie de stock au BL, SF-4). */
export function isDelivered(s: ShipmentStatus): boolean {
  return s === "livree" || s === "enlevee" || s === "reception_confirmee";
}

/** Onglets de l'écran du service livraison. */
export const SHIPMENT_TABS = [
  { key: "a_preparer", label: "À préparer", statuts: ["a_preparer"] },
  { key: "a_valider", label: "À valider (compta)", statuts: ["preparee"] },
  { key: "a_planifier", label: "À planifier", statuts: ["validee_compta"] },
  { key: "a_enlever", label: "Prêtes à enlever", statuts: ["prete_a_enlever"] },
  { key: "en_cours", label: "En cours", statuts: ["planifiee", "en_route"] },
  { key: "livrees", label: "Livrées", statuts: ["livree", "enlevee", "reception_confirmee"] },
  { key: "ecarts", label: "Échecs et litiges", statuts: ["echec", "litige"] },
] as const satisfies readonly { key: string; label: string; statuts: readonly ShipmentStatus[] }[];

export type ShipmentTabKey = (typeof SHIPMENT_TABS)[number]["key"];

export const REGLEMENT_LABELS = {
  regle: "Réglé",
  a_encaisser: "À encaisser à la livraison",
  a_terme: "À terme",
  autre: "Autre",
} as const;
export type ReglementMention = keyof typeof REGLEMENT_LABELS;
