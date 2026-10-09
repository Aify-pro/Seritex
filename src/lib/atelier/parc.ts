/**
 * Parc de sérigraphie (migration 0119) : machines et écrans. Types et
 * libellés partagés (pages Atelier > Machines et écrans, outil de
 * séparation). Sans base ni DOM.
 */

export const TYPES_MACHINE = {
  carrousel_manuel: "Carrousel manuel",
  carrousel_auto: "Carrousel automatique",
  ovale: "Machine ovale",
  table: "Table d'impression",
} as const;

export const SECHAGES = { flash: "Flash", tunnel: "Tunnel", aucun: "Aucun" } as const;

export const ETATS_ECRAN = {
  disponible: "Disponible",
  insole: "Insolé",
  a_recuperer: "À récupérer",
  hors_service: "Hors service",
} as const;

export type TypeMachine = keyof typeof TYPES_MACHINE;
export type Sechage = keyof typeof SECHAGES;
export type EtatEcran = keyof typeof ETATS_ECRAN;

export type Machine = {
  id: string;
  nom: string;
  type: TypeMachine;
  nbStations: number;
  /** Couleurs imprimables en un passage. */
  nbTetes: number;
  formatMaxLCm: number | null;
  formatMaxHCm: number | null;
  sechage: Sechage;
  /** Pièces par heure, toutes couleurs comprises. */
  cadencePiecesH: number | null;
  notes: string | null;
  active: boolean;
  /** Coût horaire machine + équipe : seulement avec les droits Tarification. */
  coutHoraire?: number | null;
};

export type EcranCadre = {
  id: string;
  code: string;
  largeurCm: number;
  hauteurCm: number;
  /** Fils par cm. */
  maillage: number;
  couleurMaille: "blanche" | "jaune";
  etat: EtatEcran;
  travail: string | null;
  emplacement: string | null;
  notes: string | null;
};

/** Marge d'un écran autour du dessin (raclette, réserve), cm de chaque côté. */
export const MARGE_ECRAN_CM = 8;

/** Un écran convient au dessin si son format intérieur laisse la marge de raclette. */
export const ecranConvient = (e: Pick<EcranCadre, "largeurCm" | "hauteurCm">, largeurCm: number, hauteurCm: number) =>
  (e.largeurCm >= largeurCm + 2 * MARGE_ECRAN_CM && e.hauteurCm >= hauteurCm + 2 * MARGE_ECRAN_CM) ||
  (e.hauteurCm >= largeurCm + 2 * MARGE_ECRAN_CM && e.largeurCm >= hauteurCm + 2 * MARGE_ECRAN_CM);

/** Le dessin tient dans le format d'impression de la machine (dans un sens ou l'autre). */
export const tientSurMachine = (m: Pick<Machine, "formatMaxLCm" | "formatMaxHCm">, largeurCm: number, hauteurCm: number) =>
  m.formatMaxLCm == null ||
  m.formatMaxHCm == null ||
  (largeurCm <= m.formatMaxLCm && hauteurCm <= m.formatMaxHCm) ||
  (largeurCm <= m.formatMaxHCm && hauteurCm <= m.formatMaxLCm);
