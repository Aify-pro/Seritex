import "server-only";
import DxfParser, { type IEntity, type IPolylineEntity, type ILwpolylineEntity } from "dxf-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import { MM_PAR_UNITE } from "@/lib/patronnage/detail";
import { normalizeShape, polygonArea, polygonPerimeter, type Point } from "@/lib/patronnage/geometry";
import { readTraceFile } from "@/lib/storage/patronnage-files";
import { VERSION_CONTRAT, type EntreeImbrication } from "./contrat";
import { traitsDeLaPiece, type Trait } from "./dessin-pieces";

/**
 * Préparation des pièces d'un calcul d'imbrication à partir de la
 * bibliothèque de patrons.
 *
 * La bibliothèque (`pattern_pieces.points`) garde chaque contour RECENTRÉ ET
 * TOURNÉ sur son axe principal, pour la reconnaissance : l'orientation
 * d'origine, donc le droit-fil, n'y est plus. On relit donc le DXF de
 * référence du patron, on y retrouve la pièce (même contour, au point près,
 * une fois normalisé de la même façon) et on prend son contour TEL QUE
 * DESSINÉ. Constaté sur les gabarits Modaris réels : droit-fil selon X,
 * courbes déjà découpées en segments (aucun arc), unité 0,1 mm.
 *
 * Choix de la v1 : tissu ouvert seulement (un semi-fini « tubulaire
 * seulement », posé au pli, est refusé avec un message clair).
 */

/** Pièces à couper pour UNE couche du matelas : semi-fini, taille, nombre. */
export interface DemandePieces {
  semiFiniId: string;
  taille: string;
  /** Nombre de pièces de ce semi-fini à obtenir par couche (ex. 2 t-shirts M = 2). */
  quantite: number;
}

export interface ParametresTissu {
  largeurUtileMm: number;
  margeLisiereMm?: number;
  longueurMaxMm?: number | null;
  espacementMm?: number;
}

/** Ce que la bibliothèque fournit pour une pièce (chargé par `chargerPatrons`). */
export interface PatronCharge {
  semiFiniId: string;
  semiFiniNom: string;
  coupeOuvert: boolean;
  piecesContourOuvert: number;
  articleCode: string;
  taille: string;
  patternId: string;
  dxfNom: string | null;
  /** Texte du DXF de référence ; null s'il est introuvable. */
  dxf: string | null;
  pieces: {
    id: string;
    nom: string;
    expectedCount: number;
    rotations: number[];
    symetrie: "aucune" | "paire";
    points: Point[];
    area: number;
    perimeter: number;
  }[];
}

/** Ce que représente chaque pièce de l'entrée du moteur (stocké avec le calcul). */
export interface PieceCalcul {
  id: string;
  patternPieceId: string;
  patternId: string;
  semiFiniId: string;
  semiFiniNom: string;
  articleCode: string;
  taille: string;
  nomPiece: string;
  miroir: boolean;
  quantite: number;
  /** Calque de la ligne de coupe dans le gabarit (repris dans le tracé). */
  calqueCoupe?: string;
  /**
   * Autres traits de la pièce (crans, couture…), en mm, dans le repère du
   * contour envoyé au moteur : le tracé exporté les porte comme un tracé
   * Modaris. Une seule fois par pièce distincte, pas par exemplaire.
   */
  traits?: Trait[];
}

export type ResultatPreparation =
  | { ok: true; entree: EntreeImbrication; pieces: PieceCalcul[] }
  | { ok: false; message: string };

/**
 * Le fichier contient-il des arcs dans ses polylignes (« bulges ») ? Le
 * parseur du module les lit comme des segments droits : pour un tracé de
 * coupe, une corde à la place d'un arc rogne la pièce et les pièces
 * voisines mordraient dessus. Un tel fichier est donc refusé plutôt
 * qu'approché en silence. (Aucun des gabarits Modaris examinés n'en a.)
 */
export function dxfContientDesArcs(texte: string): boolean {
  const dxf = new DxfParser().parseSync(texte);
  const entites: IEntity[] = [...(dxf?.entities ?? []), ...Object.values(dxf?.blocks ?? {}).flatMap((b) => b.entities ?? [])];
  return entites.some((e) => {
    if (e.type !== "LWPOLYLINE" && e.type !== "POLYLINE") return false;
    const vertices = (e as ILwpolylineEntity | IPolylineEntity).vertices ?? [];
    return vertices.some((v) => Math.abs((v as { bulge?: number }).bulge ?? 0) > 1e-9);
  });
}

/** Deux points plus proches que ceci (mm) sont un doublon. */
export const TOLERANCE_DOUBLON_MM = 0.05;
/** Un point à moins de ceci (mm) de la droite de ses voisins est aligné avec eux. */
export const TOLERANCE_ALIGNEMENT_MM = 0.01;

/**
 * Nettoie un contour (mm) : retire les points en double (y compris entre le
 * dernier et le premier) et les points alignés avec leurs voisins.
 * Constaté sur un gabarit Modaris réel (corps arrière XL, dessiné en deux
 * moitiés) : à la jonction des moitiés, le dernier point est à 0,018 mm du
 * premier, ce qui forme un minuscule « nœud papillon » que le contrôle des
 * croisements refuse à juste titre. L'écart introduit est inférieur au
 * centième de millimètre.
 */
export function nettoyerContour(points: Point[]): Point[] {
  let c = points.slice();
  let change = true;
  while (change && c.length > 3) {
    change = false;
    for (let i = 0; i < c.length && c.length > 3; i++) {
      const prec = c[(i - 1 + c.length) % c.length];
      const p = c[i];
      const suiv = c[(i + 1) % c.length];
      const doublon = Math.hypot(p[0] - prec[0], p[1] - prec[1]) < TOLERANCE_DOUBLON_MM;
      const l = Math.hypot(suiv[0] - prec[0], suiv[1] - prec[1]);
      const ecart = l === 0 ? 0 : Math.abs((suiv[0] - prec[0]) * (p[1] - prec[1]) - (suiv[1] - prec[1]) * (p[0] - prec[0])) / l;
      // Aligné ET entre ses voisins (un retour en arrière n'est pas un alignement).
      const entre = (p[0] - prec[0]) * (suiv[0] - p[0]) + (p[1] - prec[1]) * (suiv[1] - p[1]) >= 0;
      if (doublon || (ecart < TOLERANCE_ALIGNEMENT_MM && entre)) {
        c = [...c.slice(0, i), ...c.slice(i + 1)];
        change = true;
        i--;
      }
    }
  }
  return c;
}

const egal = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Retrouve dans le DXF de référence le contour d'une pièce de la
 * bibliothèque : même aire, même périmètre et mêmes points une fois
 * normalisé (la bibliothèque a été construite par ce même parseur). Rend le
 * contour tel que dessiné (unités du DXF), ou null.
 */
export function retrouverContour(
  dxf: string,
  piece: Pick<PatronCharge["pieces"][number], "points" | "area" | "perimeter">
): { calque: string; points: Point[] } | null {
  for (const c of parseDxfContours(dxf)) {
    if (c.points.length !== piece.points.length) continue;
    if (!egal(polygonArea(c.points), Number(piece.area)) || !egal(polygonPerimeter(c.points), Number(piece.perimeter))) continue;
    const norm = normalizeShape(c.points).points;
    const echelle = Math.max(...piece.points.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))), 1);
    const identique = norm.every(([x, y], i) => Math.abs(x - piece.points[i][0]) <= 1e-6 * echelle && Math.abs(y - piece.points[i][1]) <= 1e-6 * echelle);
    if (identique) return { calque: c.layer, points: c.points };
  }
  return null;
}

/**
 * Construit l'entrée du moteur (pièces en mm, rotations, quantités,
 * retournements) pour des demandes de pièces. Fonction pure : tout ce qui
 * vient de la base est dans `patrons`.
 */
export function construireEntree(
  patrons: PatronCharge[],
  demandes: DemandePieces[],
  tissu: ParametresTissu,
  calcul: { tempsS: number; graine: number; effort?: number | null }
): ResultatPreparation {
  // Demandes en double (même semi-fini, même taille) : additionnées.
  const cumul = new Map<string, DemandePieces>();
  for (const d of demandes) {
    if (!Number.isInteger(d.quantite) || d.quantite < 0) return { ok: false, message: "Les quantités doivent être des nombres entiers positifs." };
    if (d.quantite === 0) continue;
    const cle = `${d.semiFiniId}|${d.taille}`;
    const prec = cumul.get(cle);
    cumul.set(cle, { ...d, quantite: (prec?.quantite ?? 0) + d.quantite });
  }
  if (cumul.size === 0) return { ok: false, message: "Aucune pièce demandée." };

  const pieces: PieceCalcul[] = [];
  const entreePieces: EntreeImbrication["pieces"] = [];
  const contoursParFichier = new Map<string, boolean>();

  for (const d of cumul.values()) {
    const patron = patrons.find((p) => p.semiFiniId === d.semiFiniId && p.taille === d.taille);
    const nomSf = patrons.find((p) => p.semiFiniId === d.semiFiniId)?.semiFiniNom ?? "inconnu";
    if (!patron) {
      return { ok: false, message: `Le semi-fini « ${nomSf} » n'a pas de patron en taille ${d.taille} dans la bibliothèque.` };
    }
    const libelle = `« ${patron.semiFiniNom} » (${patron.taille})`;
    if (!patron.coupeOuvert) {
      return {
        ok: false,
        message: `Le semi-fini ${libelle} se coupe seulement en tubulaire (pièce au pli) : le calcul automatique ne traite pour l'instant que le tissu ouvert.`,
      };
    }
    if (patron.piecesContourOuvert !== 1) {
      return { ok: false, message: `Le semi-fini ${libelle} donne ${patron.piecesContourOuvert} pièces par contour sur tissu ouvert : cas non pris en charge par le calcul automatique.` };
    }
    if (!patron.dxf) {
      return { ok: false, message: `Le fichier DXF de référence du patron ${libelle} est introuvable : redéposez-le dans la bibliothèque.` };
    }
    if (patron.pieces.length === 0) return { ok: false, message: `Le patron ${libelle} n'a aucune pièce enregistrée.` };
    const fichier = patron.dxfNom ?? patron.patternId;
    if (!contoursParFichier.has(patron.patternId)) contoursParFichier.set(patron.patternId, dxfContientDesArcs(patron.dxf));
    if (contoursParFichier.get(patron.patternId)) {
      return {
        ok: false,
        message: `Le fichier « ${fichier} » du patron ${libelle} contient des arcs : exportez-le depuis Modaris en polylignes (courbes découpées en segments) pour le calcul automatique.`,
      };
    }

    for (const piece of patron.pieces) {
      const contourDxf = retrouverContour(patron.dxf, piece);
      if (!contourDxf) {
        return {
          ok: false,
          message: `La pièce « ${piece.nom} » du patron ${libelle} est introuvable dans son fichier « ${fichier} » : le fichier a peut-être été remplacé. Réenregistrez le patron.`,
        };
      }
      const enMm = ([x, y]: Point) => [x * MM_PAR_UNITE, y * MM_PAR_UNITE] as Point;
      const contour = nettoyerContour(contourDxf.points.map(enMm));
      const traits = traitsDeLaPiece(patron.dxf, contourDxf).map((t) => ({ ...t, points: t.points.map(enMm) }));
      const total = d.quantite * piece.expectedCount;
      const base = patron.pieces.length > 1 ? `${patron.articleCode} · ${patron.taille} · ${piece.nom}` : `${patron.articleCode} · ${patron.taille}`;
      const variantes: { id: string; miroir: boolean; quantite: number }[] =
        piece.symetrie === "paire"
          ? [
              { id: base, miroir: false, quantite: total / 2 },
              { id: `${base} · retournée`, miroir: true, quantite: total / 2 },
            ]
          : [{ id: base, miroir: false, quantite: total }];
      if (piece.symetrie === "paire" && total % 2 !== 0) {
        return {
          ok: false,
          message: `La pièce « ${piece.nom} » ${libelle} se coupe par paire (gauche + droite) : il en faut un nombre pair, ${total} demandée(s).`,
        };
      }
      for (const v of variantes) {
        if (pieces.some((p) => p.id === v.id)) return { ok: false, message: `Pièce en double dans la demande : ${v.id}.` };
        pieces.push({
          id: v.id,
          patternPieceId: piece.id,
          patternId: patron.patternId,
          semiFiniId: patron.semiFiniId,
          semiFiniNom: patron.semiFiniNom,
          articleCode: patron.articleCode,
          taille: patron.taille,
          nomPiece: piece.nom,
          miroir: v.miroir,
          quantite: v.quantite,
          calqueCoupe: contourDxf.calque,
          traits,
        });
        entreePieces.push({ id: v.id, contour, quantite: v.quantite, rotations: piece.rotations.map(Number), miroir: v.miroir });
      }
    }
  }

  return {
    ok: true,
    pieces,
    entree: {
      version: VERSION_CONTRAT,
      tissu: { largeur_utile: tissu.largeurUtileMm, marge_lisiere: tissu.margeLisiereMm ?? 0, longueur_max: tissu.longueurMaxMm ?? null },
      espacement: tissu.espacementMm ?? 0,
      calcul: { temps_max_s: calcul.tempsS, graine: calcul.graine, effort: calcul.effort ?? null },
      pieces: entreePieces,
    },
  };
}

interface LignePatron {
  id: string;
  size: string;
  reference_dxf_path: string | null;
  reference_dxf_filename: string | null;
  pattern_articles: {
    article_code: string;
    product_model_id: string;
    migre_le: string | null;
    product_models: { name: string; coupe_ouvert: boolean; pieces_contour_ouvert: number } | null;
  } | null;
  pattern_pieces: {
    id: string;
    name: string;
    expected_count: number;
    rotations_autorisees: (number | string)[];
    symetrie: "aucune" | "paire";
    points: Point[];
    area: number | string;
    perimeter: number | string;
  }[];
}

/** Charge, pour les semi-finis demandés, leurs patrons, pièces et DXF de référence. */
export async function chargerPatrons(supabase: SupabaseClient, demandes: DemandePieces[]): Promise<PatronCharge[] | { error: string }> {
  const semiFinis = [...new Set(demandes.map((d) => d.semiFiniId))];
  const tailles = [...new Set(demandes.map((d) => d.taille))];
  const { data, error } = await supabase
    .from("patterns")
    .select(
      "id,size,reference_dxf_path,reference_dxf_filename," +
        "pattern_articles!inner(article_code,product_model_id,migre_le,product_models(name,coupe_ouvert,pieces_contour_ouvert))," +
        "pattern_pieces(id,name,expected_count,rotations_autorisees,symetrie,points,area,perimeter)"
    )
    .in("pattern_articles.product_model_id", semiFinis)
    .in("size", tailles);
  if (error) return { error: `Lecture de la bibliothèque de patrons impossible : ${error.message}` };

  const fichiers = new Map<string, Promise<string | null>>();
  const lire = (chemin: string) => {
    if (!fichiers.has(chemin)) fichiers.set(chemin, readTraceFile(chemin).then((b) => (b ? b.toString("utf8") : null)));
    return fichiers.get(chemin)!;
  };

  const lignes = ((data ?? []) as unknown as LignePatron[]).filter((l) => l.pattern_articles && !l.pattern_articles.migre_le);
  return Promise.all(
    lignes.map(async (l) => ({
      semiFiniId: l.pattern_articles!.product_model_id,
      semiFiniNom: l.pattern_articles!.product_models?.name ?? l.pattern_articles!.article_code,
      coupeOuvert: l.pattern_articles!.product_models?.coupe_ouvert ?? true,
      piecesContourOuvert: l.pattern_articles!.product_models?.pieces_contour_ouvert ?? 1,
      articleCode: l.pattern_articles!.article_code,
      taille: l.size,
      patternId: l.id,
      dxfNom: l.reference_dxf_filename,
      dxf: l.reference_dxf_path ? await lire(l.reference_dxf_path) : null,
      pieces: l.pattern_pieces.map((p) => ({
        id: p.id,
        nom: p.name,
        expectedCount: p.expected_count,
        rotations: p.rotations_autorisees.map(Number),
        symetrie: p.symetrie,
        points: p.points,
        area: Number(p.area),
        perimeter: Number(p.perimeter),
      })),
    }))
  );
}
