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

export interface TracePlacement {
  id: string;
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
  // Lot 3 : tracé de rattrapage — voir supabase/migrations/0012_lot3_trace_rattrapage.sql.
  // estCorrectif=false → tracé normal. true + approuveLe=null → demande en
  // attente d'approbation. true + approuveLe renseigné → rattrapage approuvé
  // (de nouveau éditable malgré le verrou de la fiche).
  estCorrectif: boolean;
  justification: string | null;
  approuveLe: string | null;
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
