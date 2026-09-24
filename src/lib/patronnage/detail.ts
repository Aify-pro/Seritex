import {
  normalizeShape,
  alignerSurContour,
  compareShapes,
  mirrorContour,
  appliquerEchelleFichier,
  polygonArea,
  polygonPerimeter,
  type Point,
  type ShapeGeometry,
} from "@/lib/patronnage/geometry";
import {
  reconnaitreTrace,
  SEUIL_RECONNAISSANCE_DEFAUT,
  SEUIL_TAILLE_PROCHE,
  type OptionsReconnaissance,
  type ReferencePiece,
} from "@/lib/patronnage/reconnaissance";
import type { DxfContour } from "@/lib/patronnage/dxf";

/**
 * Vue détaillée d'une reconnaissance — pièce par pièce, avec la géométrie
 * nécessaire au rendu SVG (candidat vs référence superposés). C'est la forme
 * consommée par tout écran qui doit montrer CE QUE le moteur a vu dans un
 * tracé, par opposition au résumé persistable (`AnalyseTrace`,
 * lib/patronnage/types.ts) qui ne garde que les totaux.
 */
/**
 * Unité des coordonnées de la bibliothèque : 1 unité = 0,1 mm. Déduite des
 * exports Modaris réels (un matelas « 60CM » y mesure 6000 unités de haut ;
 * le DXF n'en porte pas la mention, pas de $INSUNITS). Sert UNIQUEMENT à
 * l'affichage en millimètres — jamais à la reconnaissance, qui compare des
 * formes et une échelle relative.
 */
export const MM_PAR_UNITE = 0.1;

/** Une ligne du détail « pièce par pièce » : dimensions physiques et verdict. */
export interface LignePieceDetail {
  index: number;
  layer: string;
  /**
   * Rectangle englobant aligné sur les AXES DU TRACÉ (X/Y du DXF, comme la
   * pièce est posée), grand côté d'abord — cf. dimensionsMm ci-dessous.
   */
  largeurMm: number;
  hauteurMm: number;
  perimetreMm: number;
  surfaceCm2: number;
  reconnue: boolean;
  enMiroir: boolean;
  /** Meilleur score (reconnaissance, ou meilleure piste si non reconnue). */
  score: number;
  /** Patron reconnu (null si non reconnue). */
  patron: { articleCode: string; size: string; pieceName: string } | null;
  /** Pour une pièce non reconnue : ressemble à un autre patron (autre taille) ou inconnue. */
  nature: "taille_differente" | "inconnue" | null;
}

/**
 * Dimensions physiques (mm / cm²) d'une pièce, mesurées SUR SES AXES DE POSE
 * DANS LE TRACÉ (repère X/Y du DXF), PAS sur l'axe principal de sa forme.
 *
 * `normalizeShape` tourne chaque pièce sur son axe principal d'inertie
 * (`principalAngle`) pour comparer des formes indépendamment de leur
 * rotation — c'est le bon repère pour reconnaître, mais PAS pour mesurer :
 * sur une pièce asymétrique (encolure décalée, emmanchure…), cet axe est
 * décalé de quelques degrés par rapport à la pose réelle même quand la pièce
 * est posée bien droite dans le tracé, ce qui gonflait légèrement largeur et
 * hauteur affichées (un rectangle tourné a toujours un englobant plus grand
 * que lui-même). Les tracés réels posent quasi systématiquement les pièces à
 * l'horizontale ou à la verticale (jamais en biais) : le rectangle englobant
 * DIRECT du contour, sans rotation, est donc la dimension physique réelle —
 * `Math.max`/`Math.min` absorbent le cas 90°/270° (largeur/hauteur
 * inversées mais mêmes valeurs). Périmètre et aire sont, eux, invariants par
 * rotation : recalculés ici sur le contour brut pour ne dépendre d'aucune
 * normalisation.
 *
 * Limite connue : une pièce réellement posée en biais (rare, non observé sur
 * les tracés examinés) afficherait l'encombrement occupé, plus grand que sa
 * taille intrinsèque — préférable à une mesure silencieusement faussée par
 * l'axe d'inertie sur le cas courant.
 */
function dimensionsMm(points: Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const a = (Math.max(...xs) - Math.min(...xs)) * MM_PAR_UNITE;
  const b = (Math.max(...ys) - Math.min(...ys)) * MM_PAR_UNITE;
  return {
    largeurMm: Math.round(Math.max(a, b)),
    hauteurMm: Math.round(Math.min(a, b)),
    perimetreMm: Math.round(polygonPerimeter(points) * MM_PAR_UNITE),
    surfaceCm2: Math.round(polygonArea(points) * MM_PAR_UNITE * MM_PAR_UNITE) / 100,
  };
}

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
  /** Contours intérieurs de l'exemplaire (couture, détails), même repère que `exampleCandidatePoints`. */
  exampleInnerPoints: Point[][];
}

export interface UnrecognizedPieceDetail {
  index: number;
  layer: string;
  points: Point[];
  /** Contours intérieurs (couture, détails), même repère que `points`. */
  innerPoints: Point[][];
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

/**
 * Pièces non reconnues de même forme (miroir compris), regroupées : c'est
 * l'unité d'affectation — l'administrateur associe UNE fois la famille à un
 * patron, quel que soit le nombre d'exemplaires posés dans le tracé.
 */
export interface UnrecognizedFamilyDetail {
  /** Index (dans le tracé) de toutes les pièces de la famille ; le premier sert d'exemplaire. */
  indices: number[];
  count: number;
  /** Sous-ensemble de `count` posé en miroir de l'exemplaire. */
  mirroredCount: number;
  layer: string;
  points: Point[];
  innerPoints: Point[][];
  area: number;
  perimeter: number;
  /** Dimensions physiques de l'exemplaire (mm), grand côté d'abord. */
  largeurMm: number;
  hauteurMm: number;
  /**
   * « taille_differente » : ressemble à un patron connu (≥ SEUIL_TAILLE_PROCHE)
   * sans l'égaler — autre taille probable, à faire valider. « inconnue » :
   * aucune ressemblance suffisante.
   */
  nature: "taille_differente" | "inconnue";
  bestGuess: UnrecognizedPieceDetail["bestGuess"];
}

export interface TraceAnalysisDetail {
  totalDetected: number;
  recognized: RecognizedGroupDetail[];
  unrecognized: UnrecognizedPieceDetail[];
  unrecognizedFamilies: UnrecognizedFamilyDetail[];
  /** Détail pièce par pièce (une ligne par contour du tracé), dimensions en mm. */
  lignes: LignePieceDetail[];
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
  seuil?: number,
  options?: OptionsReconnaissance
): TraceAnalysisDetail {
  const analyse = reconnaitreTrace(contours, references, seuil, options);

  // Géométries d'aperçu : reconstruites à l'échelle corrigée, pour que le
  // rendu SVG superpose bien candidat et référence même quand le fichier
  // était exporté dans une mauvaise unité.
  const corrected = appliquerEchelleFichier(
    contours.map((c) => c.points),
    analyse.facteurEchelle
  );
  // Contours intérieurs (couture, détails) : affichage seul, ramenés à la
  // même échelle que le contour de coupe puis dans son repère normalisé.
  const interieursCorriges = contours.map((c) => appliquerEchelleFichier(c.interieurs, analyse.facteurEchelle));
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
      exampleInnerPoints: exemple ? alignerSurContour(exemple, interieursCorriges[exempleIndex]) : [],
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
      innerPoints: alignerSurContour(corrected[p.index_piece], interieursCorriges[p.index_piece]),
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

  const unrecognizedFamilies = grouperEnFamilles(unrecognized, corrected, seuil ?? SEUIL_RECONNAISSANCE_DEFAUT);

  const lignes: LignePieceDetail[] = analyse.pieces.map((p) => {
    const ref = p.patron_id ? byId.get(p.patron_id) : undefined;
    return {
      index: p.index,
      layer: contours[p.index].layer,
      ...dimensionsMm(corrected[p.index]),
      reconnue: p.reconnue,
      enMiroir: p.en_miroir,
      score: p.score,
      patron: ref ? { articleCode: ref.article, size: ref.taille, pieceName: ref.piece } : null,
      nature: p.reconnue ? null : p.score >= SEUIL_TAILLE_PROCHE ? "taille_differente" : "inconnue",
    };
  });

  return {
    totalDetected: analyse.nbPiecesDetectees,
    recognized,
    unrecognized,
    unrecognizedFamilies,
    lignes,
    allRecognized: analyse.reconnaissanceComplete,
    scaleFactor: analyse.facteurEchelle,
    scoreEchelle: analyse.scoreEchelle,
    detailEchelle: analyse.detailEchelle,
    mirrorAlert: analyse.alerteMiroir,
    scaleAlert: analyse.alerteEchelle,
  };
}

/**
 * Regroupe les pièces non reconnues de même forme (comparaison directe ou en
 * miroir au seuil de reconnaissance). Le premier exemplaire de chaque famille
 * fait référence pour l'aperçu et pour la géométrie qui sera apprise.
 */
function grouperEnFamilles(
  unrecognized: UnrecognizedPieceDetail[],
  corrected: Point[][],
  seuil: number
): UnrecognizedFamilyDetail[] {
  const familles: { rep: UnrecognizedPieceDetail; repGeom: ShapeGeometry; membres: number[]; miroir: number }[] = [];

  for (const piece of unrecognized) {
    const geom = normalizeShape(corrected[piece.index]);
    const miroirGeom = normalizeShape(mirrorContour(corrected[piece.index]));
    let placee = false;
    for (const f of familles) {
      if (compareShapes(geom, f.repGeom).confidence >= seuil) {
        f.membres.push(piece.index);
        placee = true;
        break;
      }
      if (compareShapes(miroirGeom, f.repGeom).confidence >= seuil) {
        f.membres.push(piece.index);
        f.miroir += 1;
        placee = true;
        break;
      }
    }
    if (!placee) familles.push({ rep: piece, repGeom: geom, membres: [piece.index], miroir: 0 });
  }

  return familles.map(({ rep, membres, miroir }) => ({
    indices: membres,
    count: membres.length,
    mirroredCount: miroir,
    layer: rep.layer,
    points: rep.points,
    innerPoints: rep.innerPoints,
    area: rep.area,
    perimeter: rep.perimeter,
    // Dims mesurées sur la pose réelle de l'exemplaire dans le tracé (pas sur
    // `repGeom`, tourné sur son axe principal — ne sert qu'à la comparaison
    // de familles ci-dessus).
    largeurMm: dimensionsMm(corrected[rep.index]).largeurMm,
    hauteurMm: dimensionsMm(corrected[rep.index]).hauteurMm,
    nature:
      rep.bestGuess && rep.bestGuess.confidence >= SEUIL_TAILLE_PROCHE
        ? ("taille_differente" as const)
        : ("inconnue" as const),
    bestGuess: rep.bestGuess,
  }));
}
