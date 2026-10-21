/**
 * Droits de l'espace client (migration 0140). Tout est permis par défaut : la base n'enregistre
 * que les retraits (par société, ou par compte pour restreindre un seul compte).
 * La même liste figure dans la contrainte de client_droits_retires et dans definir_droit_client().
 */
export const DROITS_CLIENT = [
  { key: "devis_voir", label: "Voir les devis", description: "Consulter les devis envoyés et leurs lignes." },
  { key: "devis_accepter", label: "Accepter un devis", description: "Valider un devis envoyé (déclenche l'ordre de fabrication)." },
  { key: "commandes_voir", label: "Suivre les commandes", description: "Voir l'avancement des commandes en fabrication." },
  { key: "livraisons_voir", label: "Suivre les livraisons", description: "Voir les livraisons et leur état." },
  { key: "mediatheque_voir", label: "Médiathèque", description: "Consulter et télécharger ses fichiers (logos, maquettes…)." },
  { key: "demandes_creer", label: "Créer une demande", description: "Envoyer une nouvelle demande depuis l'espace client." },
  { key: "echantillons_voir", label: "Échantillons", description: "Voir, valider ou refuser ses échantillons." },
] as const;

export type DroitClient = (typeof DROITS_CLIENT)[number]["key"];

export const DROITS_CLIENT_CLES: string[] = DROITS_CLIENT.map((d) => d.key);
