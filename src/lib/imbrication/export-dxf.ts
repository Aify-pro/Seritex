import type { EntreeImbricationNormalisee, SortieImbrication } from "./contrat";
import type { Trait } from "./dessin-pieces";
import { transformerContour, type Point } from "./validation";

/**
 * Fichier DXF d'un tracé calculé par Seritex, au même format que les tracés
 * Modaris / Diamino déposés aujourd'hui : DXF R12 (AC1009, le format AAMA
 * des gabarits), unité 0,1 mm, longueur du matelas selon X, laize selon Y.
 *
 * Chaque exemplaire posé est écrit « à plat » (pas de bloc) : ligne de coupe
 * fermée sur le calque de coupe du gabarit (« 1 » chez Modaris), puis les
 * autres traits de la pièce (crans, couture…) sur leurs calques d'origine,
 * transformés comme la pièce. Une table de coupe lit ainsi chaque trait sans
 * avoir à résoudre de bloc.
 *
 * Les lisières (bords utiles du tissu) sont tracées en LIGNES sur un calque
 * de repère, que la reconnaissance des pièces ignore.
 *
 * Le tracé reste exactement celui que Seritex a contrôlé : mêmes contours
 * (ceux de l'entrée du moteur), mêmes placements.
 */

/** Unités du fichier par mm (0,1 mm : convention des gabarits Modaris). */
export const UNITES_PAR_MM = 10;
export const CALQUE_LISIERE = "SERITEX_REPERE_LISIERE";

export interface PieceDessin {
  id: string;
  calqueCoupe?: string;
  traits?: Trait[];
}

function nombre(v: number): string {
  // 6 décimales comme Modaris ; jamais « -0.000000 ».
  const s = v.toFixed(6);
  return s === "-0.000000" ? "0.000000" : s;
}

export function genererDxfImbrication(entree: EntreeImbricationNormalisee, sortie: SortieImbrication, pieces: PieceDessin[]): string {
  const lignes: string[] = [];
  const g = (code: number, valeur: string | number) => {
    lignes.push(String(code).padStart(3), typeof valeur === "number" ? nombre(valeur) : valeur);
  };
  const u = (mm: number) => mm * UNITES_PAR_MM;

  const polyligne = (calque: string, points: Point[], ferme: boolean) => {
    g(0, "POLYLINE");
    g(8, calque);
    g(66, "1");
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, ferme ? "1" : "0");
    for (const [x, y] of points) {
      g(0, "VERTEX");
      g(8, calque);
      g(10, u(x));
      g(20, u(y));
      g(30, 0);
    }
    g(0, "SEQEND");
    g(8, calque);
  };
  const ligne = (calque: string, a: Point, b: Point) => {
    g(0, "LINE");
    g(8, calque);
    g(10, u(a[0]));
    g(20, u(a[1]));
    g(30, 0);
    g(11, u(b[0]));
    g(21, u(b[1]));
    g(31, 0);
  };

  const parId = new Map(entree.pieces.map((p) => [p.id, p]));
  const dessin = new Map(pieces.map((p) => [p.id, p]));
  const longueur = sortie.longueur;
  const largeur = entree.tissu.largeur_utile;

  // En-tête : version R12 et emprise (longueur × laize).
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$EXTMIN");
  g(10, 0);
  g(20, 0);
  g(30, 0);
  g(9, "$EXTMAX");
  g(10, u(longueur));
  g(20, u(largeur));
  g(30, 0);
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");

  // Lisières : bords du tissu (y = 0 et y = laize) et bords utiles (marge).
  const marge = entree.tissu.marge_lisiere;
  ligne(CALQUE_LISIERE, [0, 0], [longueur, 0]);
  ligne(CALQUE_LISIERE, [0, largeur], [longueur, largeur]);
  if (marge > 0) {
    ligne(CALQUE_LISIERE, [0, marge], [longueur, marge]);
    ligne(CALQUE_LISIERE, [0, largeur - marge], [longueur, largeur - marge]);
  }

  for (const pl of sortie.placements) {
    const piece = parId.get(pl.piece_id);
    if (!piece) throw new Error(`Pièce inconnue dans le tracé : ${pl.piece_id}`);
    const d = dessin.get(pl.piece_id);
    polyligne(d?.calqueCoupe ?? "1", transformerContour(piece.contour as Point[], pl), true);
    for (const t of d?.traits ?? []) {
      polyligne(t.calque, transformerContour(t.points, pl), t.ferme);
    }
  }

  g(0, "ENDSEC");
  g(0, "EOF");
  return lignes.join("\r\n") + "\r\n";
}
