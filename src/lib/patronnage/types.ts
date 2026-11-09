import type { Point } from "@/lib/patronnage/geometry";

export interface LibraryPiece {
  id: string;
  name: string;
  expectedCount: number;
  points: Point[];
  area: number;
  perimeter: number;
}

export interface LibraryPattern {
  id: string;
  size: string;
  /** Une de ses pièces a été reconnue dans un tracé déjà analysé : suppression impossible. */
  utilise: boolean;
  pieces: LibraryPiece[];
}

export interface LibraryArticle {
  id: string;
  articleCode: string;
  designation: string;
  tolerancePct: number;
  patterns: LibraryPattern[];
}

// ============================================================
// Fiches de placement (Ordre de Placement / OT) — module Patronnage v2
// Cf. module-patronnage-specification.md
// ============================================================

export type StatutFiche = "demande" | "traces_deposes" | "bon_pour_coupe" | "archive";

/**
 * Quantités par taille, indexées par la CLÉ du référentiel (« Homme/M »), et
 * non plus par une des huit valeurs autrefois codées en dur. Voir
 * `src/lib/sizes.ts` : les tailles se règlent dans Paramètres > Couleurs et
 * tailles, et la clé est ce qui relie la répartition d'un tracé aux quantités
 * demandées d'un ODF — le rapprochement dont dépend la validation (lot 2).
 */
export type RepartitionTailles = Record<string, number>;

export interface PatronReconnu {
  patron_id: string;
  article: string;
  taille: string;
  piece: string;
  quantite: number;
  dont_en_miroir: number;
}

export interface PieceNonReconnue {
  index_piece: number;
  calque: string;
  meilleur_score: number;
  meilleur_candidat: { patron_id: string; article: string; taille: string; piece: string } | null;
}

export interface AnalyseTrace {
  id: string;
  nbPiecesDetectees: number;
  facteurEchelle: number;
  patronsReconnus: PatronReconnu[];
  piecesNonReconnues: PieceNonReconnue[];
  tauxReconnaissance: number;
  reconnaissanceComplete: boolean;
  alerteMiroir: boolean;
  alerteEchelle: boolean;
  analyseeLe: string;
}

// Lot 8 : rendement matière — vue rendement_par_trace, voir
// supabase/migrations/0018_lot8_rendement_matiere.sql. N'existe que pour un
// matelas déjà clôturé (lot 4) ; poidsTissuReelEstimeKg est une ESTIMATION
// dérivée (théorique − déchet du matelas), pas une pesée indépendante — voir
// le commentaire en tête de la migration pour le détail.
export interface RendementTrace {
  clotureLe: string;
  piecesObtenues: number;
  poidsTissuTheoriqueKg: number | null;
  poidsDechetKg: number;
  poidsTissuReelEstimeKg: number | null;
  rendementTheoriquePiecesParKg: number | null;
  rendementEstimePiecesParKg: number | null;
}

/** Statut d'un tracé (TR-1a, migration 0147) ; celui de la fiche en est le résumé. */
export type StatutTrace = "previsionnel" | "en_preparation" | "bon_pour_coupe" | "en_coupe" | "termine" | "annule";

export const STATUT_TRACE_LABELS: Record<StatutTrace, string> = {
  previsionnel: "Prévisionnel",
  en_preparation: "En préparation",
  bon_pour_coupe: "Bon pour coupe",
  en_coupe: "En coupe",
  termine: "Terminé",
  annule: "Annulé",
};

export const STATUT_TRACE_TONES: Record<StatutTrace, "neutral" | "info" | "success" | "warning" | "brand" | "danger"> = {
  previsionnel: "neutral",
  en_preparation: "info",
  bon_pour_coupe: "success",
  en_coupe: "warning",
  termine: "brand",
  annule: "danger",
};

/** Pièce posée sur un tracé regroupé (0155). */
export interface PieceTrace {
  semiFiniId: string;
  semiFiniNom: string;
  taille: string;
  quantiteParCouche: number;
  /** « dxf » : lue dans le fichier du tracé ; « saisie » : saisie à la main. */
  source: "dxf" | "saisie";
}

/** Écart de contrôle : ce qui est déclaré ne correspond pas à ce que le fichier du tracé contient. */
export interface ControleTrace {
  statut: "non_verifie" | "conforme" | "ecart";
  detail: {
    ecarts: { semi_fini: string; taille: string; declare: number; reconnu: number }[];
    hors_semi_fini: { semi_fini: string; taille: string }[];
    quantites_non_entieres: { semi_fini: string; taille: string }[];
    pieces_non_reconnues: number;
  } | null;
  derogationMotif: string | null;
  derogationLe: string | null;
}

export interface TracePlacement {
  id: string;
  /** Forme du tissu du tracé (0163). */
  forme: "ouvert" | "tubulaire";
  /** Rouleaux choisis par la PAO (0163). */
  nbRouleaux: number;
  ordre: number;
  reference: string;
  referencePatron: string | null;
  /** Centimètres (migration 0054 — en mètres auparavant). */
  longueurMatelasCm: number | null;
  largeurMatelasCm: number | null;
  nbPlis: number | null;
  repartitionParCouche: RepartitionTailles;
  fichierPath: string | null;
  fichierNom: string | null;
  chargeLe: string | null;
  analyse: AnalyseTrace | null;
  // TR-1a (0147) : statut et décisions du tracé.
  statut: StatutTrace;
  valideLe: string | null;
  motifValidation: string | null;
  /** Surplus par taille accepté avec motif à la validation (aucune tolérance). */
  surplusValide: Record<string, number> | null;
  modifieValideLe: string | null;
  annuleLe: string | null;
  motifAnnulation: string | null;
  demarreLe: string | null;
  termineLe: string | null;
  // Tracé de rattrapage (créé par un manque à la clôture du matelas) : depuis
  // TR-1a, un tracé ordinaire en préparation, sans approbation.
  estCorrectif: boolean;
  justification: string | null;
  /** Couches par article d'ODF d'un tracé regroupé (0149) ; vide pour un tracé d'article. */
  couches: { lineId: string; nbCouches: number }[];
  /** Pièces d'un tracé regroupé (0155) : semi-fini, taille et quantité par couche ; vide pour un tracé d'article. */
  pieces: PieceTrace[];
  /** Contrôle de cohérence entre les pièces déclarées et le fichier du tracé (0155, D2). */
  controle: ControleTrace;
  // Lot 8 — voir RendementTrace ci-dessus. null tant que le matelas
  // correspondant (section Coupe) n'a pas été clôturé.
  rendement: RendementTrace | null;
}

export interface FichePlacement {
  id: string;
  numeroOt: string;
  statut: StatutFiche;
  statutPrecedent: StatutFiche | null;
  /** Article (ligne d'ODF) auquel cette fiche est liée — au plus un article par fiche (migration 0037). */
  lineId: string | null;
  odfReference: string | null;
  premiereLiaisonLe: string | null;
  clientCode: string | null;
  clientLibelle: string | null;
  dateEmission: string;
  dateRetourSouhaitee: string | null;
  designationArticle: string | null;
  referenceModele: string | null;
  /**
   * Modèle choisi en cadre 1 (lot C2) — désignation, tissu, grammage et
   * laize sont désormais dérivés de ce modèle (et de son textile, lot C1)
   * plutôt que saisis librement. `null` tant que la fiche reste une simple
   * demande sans modèle choisi.
   */
  productModelId: string | null;
  quantiteTotale: number | null;
  repartitionTailles: RepartitionTailles;
  tissuType: string | null;
  grammage: number | null;
  couleur: string | null;
  laizeUtileCm: number | null;
  contraintes: string | null;
  observations: string | null;
  valideLe: string | null;
  createdAt: string;
  traces: TracePlacement[];
  /** Ordre de coupe regroupé (0149, 0155) : ses tracés portent des semi-finis pour plusieurs articles d'ODF ; faux pour une fiche d'article. */
  regroupee: boolean;
  /** Articles d'ODF regroupés (ordre regroupé seulement), avec les semi-finis de leur nomenclature et leurs tailles. */
  lignesRegroupees: {
    lineId: string;
    description: string;
    odfReference: string | null;
    semiFinis: { id: string; nom: string }[];
    tailles: string[];
  }[];
}

export interface FicheListItem {
  id: string;
  numeroOt: string;
  statut: StatutFiche;
  clientLibelle: string | null;
  referenceModele: string | null;
  odfReference: string | null;
  nbTraces: number;
  dateEmission: string;
  dateRetourSouhaitee: string | null;
}
