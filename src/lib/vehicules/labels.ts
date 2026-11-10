/**
 * Libellés et tons d'affichage du module Véhicules (migrations 0168-0172).
 * Fichier sans dépendance serveur : utilisable dans les composants client.
 */

export type VehicleStatut = "en_service" | "en_panne" | "immobilise" | "vendu";
export type VehicleUsage = "livraison" | "commercial" | "direction" | "service";
export type VehicleEnergie = "essence" | "gasoil" | "electrique" | "hybride";
export type DocumentStatut = "valide" | "a_renouveler" | "urgent" | "expire" | "manquant" | "facultatif" | "non_concerne";
export type FuelVoucherStatut = "demande" | "valide" | "refuse" | "justifie" | "annule";
export type Tone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "info";

export const VEHICLE_STATUT_LABELS: Record<VehicleStatut, string> = {
  en_service: "En service",
  en_panne: "En panne",
  immobilise: "Immobilisé",
  vendu: "Vendu",
};

export const VEHICLE_STATUT_TONES: Record<VehicleStatut, Tone> = {
  en_service: "success",
  en_panne: "danger",
  immobilise: "danger",
  vendu: "neutral",
};

export const VEHICLE_USAGE_LABELS: Record<VehicleUsage, string> = {
  livraison: "Livraison",
  commercial: "Commercial",
  direction: "Direction",
  service: "Service",
};

export const VEHICLE_ENERGIE_LABELS: Record<VehicleEnergie, string> = {
  essence: "Essence",
  gasoil: "Gasoil",
  electrique: "Électrique",
  hybride: "Hybride",
};

export const DOCUMENT_STATUT_LABELS: Record<DocumentStatut, string> = {
  valide: "Valide",
  a_renouveler: "À renouveler",
  urgent: "Urgent",
  expire: "Expiré",
  manquant: "À saisir",
  facultatif: "Facultatif",
  non_concerne: "Non concerné",
};

export const DOCUMENT_STATUT_TONES: Record<DocumentStatut, Tone> = {
  valide: "success",
  a_renouveler: "warning",
  urgent: "danger",
  expire: "danger",
  manquant: "warning",
  facultatif: "neutral",
  non_concerne: "neutral",
};

export const FUEL_VOUCHER_STATUT_LABELS: Record<FuelVoucherStatut, string> = {
  demande: "À valider",
  valide: "Validé, à justifier",
  refuse: "Refusé",
  justifie: "Justifié",
  annule: "Annulé",
};

export const FUEL_VOUCHER_STATUT_TONES: Record<FuelVoucherStatut, Tone> = {
  demande: "warning",
  valide: "brand",
  refuse: "neutral",
  justifie: "success",
  annule: "neutral",
};

/** Onglets de la liste des bons (l'ordre suit le circuit). */
export const FUEL_VOUCHER_TABS: { key: string; label: string; statuts: FuelVoucherStatut[] }[] = [
  { key: "a_valider", label: "À valider", statuts: ["demande"] },
  { key: "a_justifier", label: "À justifier", statuts: ["valide"] },
  { key: "justifies", label: "Justifiés", statuts: ["justifie"] },
  { key: "clos", label: "Refusés et annulés", statuts: ["refuse", "annule"] },
];

/** Libellé court d'un véhicule : « Camion 1 · 2632JP01 ». */
export function vehicleLabel(v: { libelle: string; immatriculation: string | null }): string {
  return [v.libelle, v.immatriculation].filter(Boolean).join(" · ");
}

/** « 12 450 km ». */
export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR").format(km)} km`;
}

/** « J-12 », « Aujourd'hui », « Expiré depuis 3 j ». */
export function formatJours(jours: number | null | undefined): string {
  if (jours === null || jours === undefined) return "";
  if (jours === 0) return "aujourd'hui";
  if (jours > 0) return `dans ${jours} j`;
  return `depuis ${-jours} j`;
}
