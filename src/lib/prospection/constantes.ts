/**
 * Libellés du module Prospection (migration 0122). Les clés sont celles des
 * contraintes CHECK de la base.
 */

export const ETAPES_PROSPECTION = {
  suspect: "Suspect",
  prospect: "Prospect",
  qualifie: "Qualifié",
  proposition: "Proposition",
  client: "Client",
  perdu: "Perdu",
} as const;
export type EtapeProspection = keyof typeof ETAPES_PROSPECTION;

export const TYPES_JOUR = {
  visites: "Visites (rapport obligatoire)",
  reunion: "Réunion et rapports",
  repos: "Repos",
} as const;
export type TypeJour = keyof typeof TYPES_JOUR;

/** Jours ISO : index 0 = lundi … 6 = dimanche (types_jour[1..7] en base). */
export const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

export const MOTIFS_ABSENCE = {
  permission: "Permission",
  maladie: "Maladie",
  conge: "Congé",
  mission: "Mission",
  autre: "Autre",
} as const;
export type MotifAbsence = keyof typeof MOTIFS_ABSENCE;

export const STATUTS_ABSENCE = {
  demandee: "Demandée",
  validee: "Validée",
  refusee: "Refusée",
} as const;
export type StatutAbsence = keyof typeof STATUTS_ABSENCE;

export const CANAUX = ["whatsapp", "telegram", "email", "application"] as const;
export type Canal = (typeof CANAUX)[number];

/** Ce que « réception » veut dire pour chaque canal. */
export const RECEPTION_CANAL: Record<Canal, string> = {
  whatsapp: "Rapports vocaux et écrits reçus par Evolution API",
  telegram: "Rapports reçus par le bot Telegram",
  email: "Suivi des boîtes e-mail professionnelles (tri JEV)",
  application: "Rapports saisis dans le module",
};

/** Réponse de prospection_statut_journee() : « due » ou la raison de la dispense. */
export const STATUTS_JOURNEE = {
  due: "Rapport attendu",
  hors_prospection: "Pas suivi",
  inactif: "Inactif",
  direction: "Direction (dispensé)",
  non_soumis: "Dispensé",
  ferie: "Jour férié",
  reunion: "Réunion",
  repos: "Repos",
  absence: "Absent",
} as const;
export type StatutJournee = keyof typeof STATUTS_JOURNEE;

/** Date du jour à Abidjan (UTC+0, sans heure d'été), au format AAAA-MM-JJ. */
export function aujourdhuiAbidjan(): string {
  return new Date().toISOString().slice(0, 10);
}

/** « 2026-10-12 » → « lun. 12 oct. 2026 ». */
export function dateCourte(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
