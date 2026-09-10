import {
  normalizeShape,
  compareShapes,
  appliquerEchelleFichier,
  type Point,
} from "@/lib/patronnage/geometry";
import { reconnaitreTrace, type ReferencePiece } from "@/lib/patronnage/reconnaissance";
import type { DxfContour } from "@/lib/patronnage/dxf";

/**
 * Vue détaillée d'une reconnaissance — pièce par pièce, avec la géométrie
 * nécessaire au rendu SVG (candidat vs référence superposés). C'est la forme
 * consommée par tout écran qui doit montrer CE QUE le moteur a vu dans un
 * tracé, par opposition au résumé persistable (`AnalyseTrace`,
 * lib/patronnage/types.ts) qui ne garde que les totaux.
 */
export interface RecognizedGroupDetail {
  patternPieceId: string;
  articleCode: string;
  size: string;
  pieceName: string;
  count: number;
  /** Sous-ensemble de `count` reconnu via la passe miroir — alerte, non bloquant. */
  mirroredCount: number;
  referencePoints: Point[];
  exampleCandidatePoints: Point[];
}

export interface UnrecognizedPieceDetail {
  index: number;
  layer: string;
  points: Point[];
  area: number;
  perimeter: number;
  bestGuess: {
    articleCode: string;
    size: string;
    pieceName: string;
    referencePoints: Point[];
    confidence: number;
    areaDiffPct: number;
    perimDiffPct: number;
    shapeDiffPct: number;
  } | null;
}

export interface TraceAnalysisDetail {
  totalDetected: number;
  recognized: RecognizedGroupDetail[];
  unrecognized: UnrecognizedPieceDetail[];
  allRecognized: boolean;
  /** Facteur d'échelle fichier appliqué (1 = aucune correction). */
  scaleFactor: number;
  /** Score global de la pré-passe d'échelle + détail par facteur — audit, jamais affiché avant ce module. */
  scoreEchelle: number;
  detailEchelle: Record<string, number>;
  mirrorAlert: boolean;
  scaleAlert: boolean;
}

/**
 * Construit la vue détaillée à partir des contours bruts d'un tracé et de la
 * bibliothèque de référence — relance le moteur (`reconnaitreTrace`) puis
 * enrichit son verdict avec la géométrie de chaque pièce, pour le rendu
 * visuel. Fonction pure et partagée : utilisée aussi bien par l'outil
 * d'analyse ponctuelle (`analyzeTraceDxf`, hors fiche) que par la fenêtre
 * "Détail" d'un tracé déjà déposé sur une fiche (`getTraceDetail`) — un seul
 * endroit qui sait transformer un verdict de reconnaissance en écran,
 * jamais deux implémentations qui pourraient diverger.
 */
export function construireAnalyseDetaillee(
  contours: DxfContour[],
  references: ReferencePiece[],
  seuil?: number
): TraceAnalysisDetail {
  const analyse = reconnaitreTrace(contours, references, seuil);

  // Géométries d'aperçu : reconstruites à l'échelle corrigée, pour que le
  // rendu SVG superpose bien candidat et référence même quand le fichier
  // était exporté dans une mauvaise unité.
  const corrected = appliquerEchelleFichier(
    contours.map((c) => c.points),
    analyse.facteurEchelle
  );
  const byId = new Map(references.map((r) => [r.id, r]));

  const recognized: RecognizedGroupDetail[] = analyse.patronsReconnus.map((g) => {
    const ref = byId.get(g.patron_id);
    const exempleIndex = analyse.exempleParPatron[g.patron_id];
    const exemple = exempleIndex !== undefined ? corrected[exempleIndex] : undefined;
    return {
      patternPieceId: g.patron_id,
      articleCode: g.article,
      size: g.taille,
      pieceName: g.piece,
      count: g.quantite,
      mirroredCount: g.dont_en_miroir,
      referencePoints: ref?.geom.points ?? [],
      exampleCandidatePoints: exemple ? normalizeShape(exemple).points : [],
    };
  });

  const unrecognized: UnrecognizedPieceDetail[] = analyse.piecesNonReconnues.map((p) => {
    const geom = normalizeShape(corrected[p.index_piece]);
    const candidat = p.meilleur_candidat;
    const ref = candidat ? byId.get(candidat.patron_id) : undefined;
    // Détail des écarts recalculé pour l'affichage ; le score de confiance
    // affiché reste celui retenu par le moteur (source unique du verdict).
    const detail = ref ? compareShapes(geom, ref.geom) : null;
    return {
      index: p.index_piece,
      layer: p.calque,
      points: geom.points,
      area: Math.round(geom.area),
      perimeter: Math.round(geom.perimeter),
      bestGuess:
        candidat && ref && detail
          ? {
              articleCode: candidat.article,
              size: candidat.taille,
              pieceName: candidat.piece,
              referencePoints: ref.geom.points,
              confidence: p.meilleur_score,
              areaDiffPct: detail.areaDiffPct,
              perimDiffPct: detail.perimDiffPct,
              shapeDiffPct: detail.shapeDiffPct,
            }
          : null,
    };
  });

  return {
    totalDetected: analyse.nbPiecesDetectees,
    recognized,
    unrecognized,
    allRecognized: analyse.reconnaissanceComplete,
    scaleFactor: analyse.facteurEchelle,
    scoreEchelle: analyse.scoreEchelle,
    detailEchelle: analyse.detailEchelle,
    mirrorAlert: analyse.alerteMiroir,
    scaleAlert: analyse.alerteEchelle,
  };
}
