import {
  normalizeShape,
  compareShapes,
  detecterEchelleFichier,
  appliquerEchelleFichier,
  testerEnMiroir,
  type ReferenceGeom,
  type FacteurEchelle,
  type ShapeGeometry,
} from "@/lib/patronnage/geometry";
import type { DxfContour } from "@/lib/patronnage/dxf";
import type { PatronReconnu, PieceNonReconnue } from "@/lib/patronnage/types";

/**
 * Pipeline de reconnaissance d'un tracé de placement Diamino — point d'entrée
 * unique du moteur, utilisé par toute action serveur qui analyse un tracé.
 *
 * Ordre des passes (cf. module-patronnage-specification.md §7) :
 *   1. Pré-passe d'échelle FICHIER : facteurs discrets {0.01…1000}, facteur
 *      unique appliqué à l'ensemble du tracé — jamais pièce par pièce. Logique
 *      totalement étanche à la détection d'écart de taille (~5-6 %/taille),
 *      qui reste du ressort du seuil de reconnaissance.
 *   2. Comparaison directe de chaque pièce contre TOUTE la bibliothèque
 *      (jamais restreinte à un article déclaré), invariante en rotation.
 *   3. Passe réflexion : toute pièce non reconnue en direct est retestée en
 *      miroir ; si reconnue ainsi, elle compte comme reconnue mais est
 *      marquée « en miroir » (alerte non bloquante, jamais masquée).
 *
 * Fonction pure (aucun accès base/stockage) : les actions serveur chargent la
 * bibliothèque et persistent le résultat ; le moteur, lui, est testable seul.
 */

/** Pièce de référence enrichie des métadonnées nécessaires au rapport. */
export interface ReferencePiece extends ReferenceGeom {
  article: string;
  taille: string;
  piece: string;
}

export interface ResultatReconnaissance {
  nbPiecesDetectees: number;
  facteurEchelle: FacteurEchelle;
  /** Score global de la pré-passe d'échelle + détail par facteur (audit). */
  scoreEchelle: number;
  detailEchelle: Record<string, number>;
  patronsReconnus: PatronReconnu[];
  piecesNonReconnues: PieceNonReconnue[];
  tauxReconnaissance: number;
  reconnaissanceComplete: boolean;
  alerteMiroir: boolean;
  alerteEchelle: boolean;
  /**
   * Index (dans le tracé) d'un exemplaire représentatif par patron reconnu.
   * Sert uniquement à l'aperçu : permet à l'écran de superposer la bonne
   * pièce du tracé avec sa référence, plutôt qu'un contour pris au hasard.
   * Non persisté — les index n'ont de sens que pour ce fichier.
   */
  exempleParPatron: Record<string, number>;
}

export const SEUIL_RECONNAISSANCE_DEFAUT = 98;

export function reconnaitreTrace(
  contours: DxfContour[],
  references: ReferencePiece[],
  seuil: number = SEUIL_RECONNAISSANCE_DEFAUT
): ResultatReconnaissance {
  const rawPoints = contours.map((c) => c.points);

  // 1. Pré-passe d'échelle fichier
  const echelle = detecterEchelleFichier(rawPoints, references, seuil);
  const correctedPoints = appliquerEchelleFichier(rawPoints, echelle.facteur);

  // 2 + 3. Comparaison directe puis passe miroir
  const tally = new Map<
    string,
    { ref: ReferencePiece; count: number; miroirCount: number; exempleIndex: number }
  >();
  const piecesNonReconnues: PieceNonReconnue[] = [];

  const compterReconnue = (ref: ReferencePiece, enMiroir: boolean, index: number) => {
    const existing = tally.get(ref.id);
    if (existing) {
      existing.count += 1;
      if (enMiroir) existing.miroirCount += 1;
    } else {
      tally.set(ref.id, { ref, count: 1, miroirCount: enMiroir ? 1 : 0, exempleIndex: index });
    }
  };

  for (let i = 0; i < correctedPoints.length; i++) {
    const candGeom: ShapeGeometry = normalizeShape(correctedPoints[i]);

    let best: { confidence: number; ref: ReferencePiece } | null = null;
    for (const ref of references) {
      const cmp = compareShapes(candGeom, ref.geom);
      if (!best || cmp.confidence > best.confidence) best = { confidence: cmp.confidence, ref };
    }

    if (best && best.confidence >= seuil) {
      compterReconnue(best.ref, false, i);
      continue;
    }

    const miroir = testerEnMiroir(correctedPoints[i], references, seuil);
    if (miroir.reconnu && miroir.reference) {
      compterReconnue(miroir.reference as ReferencePiece, true, i);
      continue;
    }

    // Jamais masquée : remontée individuellement avec sa meilleure piste
    piecesNonReconnues.push({
      index_piece: i,
      calque: contours[i].layer,
      meilleur_score: best?.confidence ?? 0,
      meilleur_candidat: best
        ? { patron_id: best.ref.id, article: best.ref.article, taille: best.ref.taille, piece: best.ref.piece }
        : null,
    });
  }

  const patronsReconnus: PatronReconnu[] = Array.from(tally.values()).map((g) => ({
    patron_id: g.ref.id,
    article: g.ref.article,
    taille: g.ref.taille,
    piece: g.ref.piece,
    quantite: g.count,
    dont_en_miroir: g.miroirCount,
  }));

  const totalReconnu = patronsReconnus.reduce((s, p) => s + p.quantite, 0);

  const exempleParPatron: Record<string, number> = {};
  for (const g of tally.values()) exempleParPatron[g.ref.id] = g.exempleIndex;

  return {
    exempleParPatron,
    nbPiecesDetectees: contours.length,
    facteurEchelle: echelle.facteur,
    scoreEchelle: echelle.scoreGlobal,
    detailEchelle: echelle.detailParFacteur,
    patronsReconnus,
    piecesNonReconnues,
    tauxReconnaissance: contours.length > 0 ? totalReconnu / contours.length : 0,
    reconnaissanceComplete: piecesNonReconnues.length === 0,
    alerteMiroir: patronsReconnus.some((p) => p.dont_en_miroir > 0),
    alerteEchelle: echelle.facteur !== 1,
  };
}
