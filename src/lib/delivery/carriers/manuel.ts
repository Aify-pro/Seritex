import type { CarrierConnector } from "./types";

/**
 * Transporteur « manuel » (flotte Seritex ou prestataire appelé au
 * téléphone) : aucune API. Le prix se saisit (coût estimé / réel sur
 * l'expédition), le suivi est celui des statuts posés par le livreur.
 */
export const manuel: CarrierConnector = {
  integration: "manuel",
  async estimer() {
    return { montant: null, devise: "XOF", delaiHeures: null };
  },
  async creer() {
    return { carrierRef: null };
  },
  async annuler() {},
  async suivre() {
    return null;
  },
  async recevoirNotification() {
    return null;
  },
};
