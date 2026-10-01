/**
 * Libellé d'une impression : « Devant (2 couleurs) ». Partagé par la fiche
 * devis, la proforma PDF et le PDF de l'ODF (migration 0065) ; un nombre de
 * couleurs inconnu (emplacement coché sur l'ODF avant 0065) ne s'affiche pas.
 */
export function printableZoneLabel(zoneLabel: string, nbCouleurs: number | null | undefined): string {
  if (!nbCouleurs) return zoneLabel;
  return `${zoneLabel} (${nbCouleurs} couleur${nbCouleurs > 1 ? "s" : ""})`;
}
