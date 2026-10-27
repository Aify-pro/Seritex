/**
 * Adresse publique du site www.seritex.ci, où vit tout le parcours client
 * (devis, commandes, livraisons, confirmation de réception). Réglage de marque
 * (Paramètres > Notifications), sinon la valeur par défaut ci-dessous.
 * `{{lien_site}}` dans un modèle d'e-mail = cette adresse, sans « / » final ;
 * `{{lien_base}}` reste l'adresse de la plateforme (messages destinés au personnel).
 */
export const SITE_PAR_DEFAUT = "https://www.seritex.ci";

export function adresseSite(configuree: string | null | undefined): string {
  const v = configuree?.trim().replace(/\/+$/, "");
  return v || SITE_PAR_DEFAUT;
}
