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

export const REPARTITION_TAILLES_KEYS = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Autre"] as const;
export type TailleKey = (typeof REPARTITION_TAILLES_KEYS)[number];
export type RepartitionTailles = Partial<Record<TailleKey, number>>;

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

export interface TracePlacement {
  id: string;
  ordre: number;
  reference: string;
  referencePatron: string | null;
  longueurMatelasM: number | null;
  largeurMatelasCm: number | null;
  nbPlis: number | null;
  repartitionParCouche: RepartitionTailles;
  fichierPath: string | null;
  fichierNom: string | null;
  chargeLe: string | null;
  analyse: AnalyseTrace | null;
}

export interface FichePlacement {
  id: string;
  numeroOt: string;
  statut: StatutFiche;
  statutPrecedent: StatutFiche | null;
  odfId: string | null;
  odfReference: string | null;
  premiereLiaisonOdfLe: string | null;
  clientCode: string | null;
  clientLibelle: string | null;
  dateEmission: string;
  dateRetourSouhaitee: string | null;
  designationArticle: string | null;
  referenceModele: string | null;
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
