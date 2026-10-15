/**
 * Parc de sérigraphie (migration 0119) : machines et écrans. Types et
 * libellés partagés (pages Atelier > Machines et écrans, outil de
 * séparation). Sans base ni DOM.
 */

export const FAMILLES_MACHINE = { serigraphie: "Sérigraphie", numerique: "Impression numérique" } as const;

export const TYPES_SERIGRAPHIE = {
  carrousel_manuel: "Carrousel manuel",
  carrousel_auto: "Carrousel automatique",
  ovale: "Machine ovale",
  table: "Table d'impression",
} as const;

export const TYPES_NUMERIQUE = {
  dtf: "DTF (film + poudre)",
  dtf_uv: "DTF UV",
  dtg: "DTG (direct sur textile)",
  roll_to_roll: "Roll to roll (rouleau)",
  sublimation: "Sublimation",
  uv_plat: "UV à plat",
  ecosolvant: "Éco-solvant / latex",
} as const;

export const TYPES_MACHINE = { ...TYPES_SERIGRAPHIE, ...TYPES_NUMERIQUE } as const;

export const SECHAGES = {
  flash: "Flash",
  tunnel: "Tunnel",
  four: "Four (poudre, fixation)",
  led_uv: "LED UV",
  integre: "Intégré à la machine",
  aucun: "Aucun",
} as const;

/** Familles et séchages proposés selon la famille (le séchage « flash » n'a pas de sens sur un DTF). */
export const SECHAGES_PAR_FAMILLE: Record<keyof typeof FAMILLES_MACHINE, (keyof typeof SECHAGES)[]> = {
  serigraphie: ["flash", "tunnel", "aucun"],
  numerique: ["integre", "four", "led_uv", "aucun"],
};

/** Valeurs par défaut d'une nouvelle machine numérique, selon le type (modifiables ensuite). */
export const DEFAUTS_NUMERIQUE: Record<keyof typeof TYPES_NUMERIQUE, { technologie: string; blanc: boolean; sechage: keyof typeof SECHAGES }> = {
  dtf: { technologie: "Pigmentée sur film PET", blanc: true, sechage: "four" },
  dtf_uv: { technologie: "UV sur film A/B", blanc: true, sechage: "led_uv" },
  dtg: { technologie: "Pigmentée textile", blanc: true, sechage: "four" },
  roll_to_roll: { technologie: "Éco-solvant / latex / sublimation", blanc: false, sechage: "integre" },
  sublimation: { technologie: "Sublimation (transfert)", blanc: false, sechage: "integre" },
  uv_plat: { technologie: "UV durcissable LED", blanc: true, sechage: "led_uv" },
  ecosolvant: { technologie: "Éco-solvant / latex", blanc: false, sechage: "integre" },
};

export const familleDuType = (type: TypeMachine): FamilleMachine => (type in TYPES_NUMERIQUE ? "numerique" : "serigraphie");

export const ETATS_ECRAN = {
  disponible: "Disponible",
  insole: "Insolé",
  a_recuperer: "À récupérer",
  hors_service: "Hors service",
} as const;

export type FamilleMachine = keyof typeof FAMILLES_MACHINE;
export type TypeMachine = keyof typeof TYPES_MACHINE;
export type Sechage = keyof typeof SECHAGES;
export type EtatEcran = keyof typeof ETATS_ECRAN;

export type Machine = {
  id: string;
  nom: string;
  famille: FamilleMachine;
  type: TypeMachine;
  nbStations: number;
  /** Sérigraphie : couleurs imprimables en un passage. Numérique : têtes d'impression. */
  nbTetes: number;
  formatMaxLCm: number | null;
  formatMaxHCm: number | null;
  sechage: Sechage;
  /** Pièces par heure, toutes couleurs comprises. */
  cadencePiecesH: number | null;
  notes: string | null;
  active: boolean;
  /** Fiche technique, surtout pour l'impression numérique. */
  marqueModele: string | null;
  technologieEncre: string | null;
  nbCanauxEncre: number | null;
  encreBlanche: boolean;
  modeleTetes: string | null;
  resolutionDpi: number | null;
  vitesseM2H: number | null;
  consoEncreMlM2: number | null;
  ripLogiciel: string | null;
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
