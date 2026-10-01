import type { DelaiDepart, DelaiUnite } from "@/lib/types/domain";

/**
 * Délai de livraison normalisé (migration 0061) : valeur + unité + point de
 * départ, ou date ferme (quotes.date_livraison_prevue). Un seul libellé
 * partout (fiche, PDF) pour que « 4 semaines » ne s'écrive pas de six façons.
 */
export const DELAI_UNITES: { value: DelaiUnite; one: string; many: string }[] = [
  { value: "jours", one: "jour", many: "jours" },
  { value: "jours_ouvres", one: "jour ouvré", many: "jours ouvrés" },
  { value: "semaines", one: "semaine", many: "semaines" },
  { value: "mois", one: "mois", many: "mois" },
];

export const DELAI_DEPARTS: { value: DelaiDepart; label: string }[] = [
  { value: "commande", label: "la commande" },
  { value: "acompte", label: "la réception de l'acompte" },
  { value: "validation_echantillon", label: "la validation de l'échantillon" },
];

export function delaiLabel(valeur: number | null | undefined, unite: DelaiUnite | null | undefined, depart: DelaiDepart | null | undefined): string | null {
  if (!valeur || !unite) return null;
  const u = DELAI_UNITES.find((x) => x.value === unite);
  const d = DELAI_DEPARTS.find((x) => x.value === depart);
  return `${valeur} ${valeur > 1 ? u?.many : u?.one}${d ? ` à compter de ${d.label}` : ""}`;
}
