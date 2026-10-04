/**
 * Statuts d'ODF dont les sous-ODF (work_orders) sont à produire dans les sections :
 * en production, ou clôture demandée (la saisie reste permise jusqu'à la
 * confirmation). Un ODF terminé ou annulé sort des files de section — annuler ou
 * clôturer ne modifie que le statut de l'ODF, jamais celui de ses sous-ODF.
 */
export const ACTIVE_ODF_STATUSES = ["en_production", "demande_cloture"];
