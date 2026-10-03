/**
 * Connecteur de transporteur (LIV-0/LIV-1). Chaque transporteur a le sien,
 * avec les mêmes opérations : estimer le prix, créer, annuler, suivre,
 * recevoir les notifications du prestataire. Seul « manuel » est livré en
 * version 1 ; Yango et DHL viendront avec l'e-shop (L6).
 */
export interface CarrierShipmentInput {
  shipmentId: string;
  reference: string | null;
  destination: { libelle: string | null; latitude: number | null; longitude: number | null; contact: string | null; telephone: string | null };
  colis: number;
  poidsKg: number | null;
}

export interface CarrierQuote {
  montant: number | null;
  devise: string;
  delaiHeures: number | null;
}

export interface CarrierTracking {
  statut: string;
  position: { latitude: number; longitude: number } | null;
  misAJourLe: string;
}

export interface CarrierConnector {
  integration: "manuel" | "yango" | "dhl";
  estimer(input: CarrierShipmentInput): Promise<CarrierQuote>;
  creer(input: CarrierShipmentInput): Promise<{ carrierRef: string | null }>;
  annuler(carrierRef: string | null): Promise<void>;
  suivre(carrierRef: string | null): Promise<CarrierTracking | null>;
  /** Notification entrante du prestataire (webhook) → statut Seritex, ou null si sans objet. */
  recevoirNotification(payload: unknown): Promise<{ carrierRef: string; statut: string } | null>;
}
