import type { CarrierConnector } from "./types";
import { manuel } from "./manuel";

/** Connecteur d'un transporteur selon son mode de connexion — seul « manuel » existe en version 1. */
export function carrierConnector(integration: string): CarrierConnector {
  if (integration === "manuel") return manuel;
  throw new Error(`Connexion « ${integration} » non disponible en version 1 (prévue avec l'e-shop).`);
}
