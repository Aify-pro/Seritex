import "server-only";
import QRCode from "qrcode";
import { centroid, type Point } from "@/lib/patronnage/geometry";
import type { DxfContour } from "@/lib/patronnage/dxf";
import { MM_PAR_UNITE, type LignePieceDetail } from "@/lib/patronnage/detail";
import { construireContenuCartouche, type CartoucheInfo, type LigneCartouche, type OrientationCartouche } from "@/lib/patronnage/cartouche";

export type { CartoucheInfo, OrientationCartouche };

/**
 * Génère le DXF « marqué » d'un tracé déjà déposé : texte au centre de chaque
 * patron reconnu (article, taille, pièce) et cartouche (QR + infos) sous le
 * tracé, pour un document téléchargeable qui dit de lui-même à quoi il
 * correspond — sans attendre que quelqu'un rouvre la fiche sur la plateforme.
 *
 * Principe directeur : SURCHARGE, jamais régénération. On repart du texte
 * BRUT du fichier déposé par la PAO et on y AJOUTE de nouvelles entités
 * (TEXTE, QR vectoriel, cadre) dans sa section ENTITIES — on ne redessine
 * JAMAIS les pièces elles-mêmes à partir des contours déjà analysés
 * (`parseDxfContours`). Deux raisons, non négociables :
 *  1. Ce parseur approxime les arcs/bulges en segments droits (limite
 *     documentée de dxf.ts) — régénérer le dessin à partir de ces contours
 *     figerait cette approximation dans le fichier remis à la coupe, alors
 *     que le fichier original, lui, garde les vraies courbes.
 *  2. Le marquage ne doit JAMAIS changer l'échelle physique du tracé : le
 *     facteur d'échelle détecté (ou choisi) par le moteur sert UNIQUEMENT à
 *     la reconnaissance, jamais à repositionner le dessin. Les contours
 *     utilisés ici pour centrer le texte sont donc les contours BRUTS
 *     (`DxfContour.points`, tels qu'exportés), jamais une version « corrigée ».
 *
 * Toutes les entités ajoutées portent des calques dédiés (SERITEX_*),
 * absents du dessin d'origine, pour qu'elles restent identifiables/
 * masquables sans toucher au reste. Elles ne sont PAS déclarées dans une
 * table LAYER (section TABLES) : un lecteur DXF tolérant (dont notre propre
 * parseur, cf. test) les affiche sur les propriétés par défaut, ce qui est
 * suffisant ici ; un futur besoin de calques colorés dans la table devra
 * ajouter cette déclaration.
 */

const UNITES_PAR_MM = 1 / MM_PAR_UNITE; // 10 : cf. detail.ts pour l'origine de cette constante

const COUCHE_MARQUAGE = "SERITEX_MARQUAGE";
const COUCHE_CARTOUCHE = "SERITEX_CARTOUCHE";
const COUCHE_QR = "SERITEX_QR";

const HAUTEUR_TEXTE_PIECE_MM = 12;
const DEMI_CROIX_MM = 4;

const CARTOUCHE_HAUTEUR_MM = 55;
const CARTOUCHE_LARGEUR_MIN_MM = 180;
const CARTOUCHE_MARGE_MM = 15; // entre le bas du tracé et le haut du cartouche
const CARTOUCHE_PADDING_MM = 6;
const QR_TAILLE_MM = 32;

const COULEUR_VERT = 3; // ACI — vert : tout reconnu
const COULEUR_ROUGE = 1; // ACI — rouge : au moins une pièce non reconnue

// Cartouche vertical : largeur FIXE (pas liée à la largeur du tracé, à
// l'inverse de l'horizontal) — une colonne étroite, pas un bandeau.
const CARTOUCHE_V_LARGEUR_MM = 120;

export function genererDxfMarque(
  dxfOriginal: string,
  contours: DxfContour[],
  lignes: LignePieceDetail[],
  info: CartoucheInfo,
  orientation: OrientationCartouche = "horizontal"
): { dxf: string } | { error: string } {
  if (contours.length === 0 || lignes.length === 0) {
    return { error: "Aucune pièce à marquer dans ce tracé." };
  }

  const mm = (n: number) => n * UNITES_PAR_MM;

  // Boîte englobante du tracé ENTIER, sur les contours BRUTS (coordonnées
  // natives du fichier — cf. en-tête) : sert à placer le cartouche sous le
  // dessin, sans jamais l'avoir à redimensionner.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { error: "Tracé vide : rien à marquer." };

  let entites = "";

  // --- Marquage de chaque pièce, au centroïde de son contour BRUT ---
  for (const ligne of lignes) {
    const points = contours[ligne.index]?.points;
    if (!points || points.length < 3) continue;
    const point = centroid(points);
    const texte =
      ligne.reconnue && ligne.patron
        ? `${ligne.patron.articleCode} · ${ligne.patron.size} · ${ligne.patron.pieceName}${ligne.enMiroir ? " (miroir)" : ""}`
        : "NON RECONNUE";
    entites += entiteTexteCentre(point, mm(HAUTEUR_TEXTE_PIECE_MM), texte, COUCHE_MARQUAGE);
    // Petite croix au centroïde exact : montre où le moteur a mesuré, utile
    // à la vérification humaine qui est tout le sens de ce module (cf.
    // reconnaissance.ts — « nous servait de vérification des tracés »).
    entites += entiteCroix(point, mm(DEMI_CROIX_MM), COUCHE_MARQUAGE);
  }

  // --- Cartouche : sous le tracé. En horizontal, un bandeau pleine largeur
  // (jamais plus étroit que la laize déjà respectée par la PAO) avec le QR à
  // gauche et le texte à droite ; en vertical, une colonne étroite de
  // largeur fixe avec le QR en haut et le texte empilé dessous.
  const contenu = construireContenuCartouche(lignes, info);
  const pad = mm(CARTOUCHE_PADDING_MM);
  const qrTaille = mm(QR_TAILLE_MM);
  const hauteurLigne = (l: LigneCartouche) => (l.accent === "titre" ? 6.5 : l.accent ? 5 : 4.5);
  const hauteurTexteTotal = contenu.lignes.reduce((s, l) => s + hauteurLigne(l) + 1.5, 0);

  const x0 = minX;
  const largeurCartouche =
    orientation === "horizontal" ? Math.max(maxX - minX, mm(CARTOUCHE_LARGEUR_MIN_MM)) : mm(CARTOUCHE_V_LARGEUR_MM);
  const hauteurCartouche =
    orientation === "horizontal" ? mm(CARTOUCHE_HAUTEUR_MM) : pad * 3 + qrTaille + mm(hauteurTexteTotal);
  const x1 = x0 + largeurCartouche;
  const y1 = minY - mm(CARTOUCHE_MARGE_MM);
  const y0 = y1 - hauteurCartouche;

  entites += entiteRectangle(x0, y0, x1, y1, COUCHE_CARTOUCHE);

  const couleurAccent = (l: LigneCartouche) =>
    l.accent === "verdict_ok" ? COULEUR_VERT : l.accent === "verdict_ko" ? COULEUR_ROUGE : undefined;

  if (orientation === "horizontal") {
    entites += dessinerQr(contenu.qrUrl, x0 + pad, y0 + pad, qrTaille, COUCHE_QR);
    // Repli lisible à l'œil sous le QR, si le scan ne passe pas — même
    // convention que les étiquettes de sacs de déchets (waste-bag-label.ts).
    entites += entiteTexteCentre([x0 + pad + qrTaille / 2, y0 + pad / 2], mm(3.5), contenu.qrLegende, COUCHE_CARTOUCHE);

    const xTexte = x0 + pad + qrTaille + pad;
    let curY = y1 - pad;
    for (const l of contenu.lignes) {
      curY -= mm(hauteurLigne(l));
      entites += entiteTexteGauche([xTexte, curY], mm(hauteurLigne(l)), l.texte, COUCHE_CARTOUCHE, couleurAccent(l));
      curY -= mm(1.5);
    }
  } else {
    const xCentre = x0 + largeurCartouche / 2;
    entites += dessinerQr(contenu.qrUrl, xCentre - qrTaille / 2, y1 - pad - qrTaille, qrTaille, COUCHE_QR);
    entites += entiteTexteCentre([xCentre, y1 - pad - qrTaille - mm(4)], mm(3.5), contenu.qrLegende, COUCHE_CARTOUCHE);

    let curY = y1 - pad - qrTaille - mm(4) - mm(5.5);
    for (const l of contenu.lignes) {
      curY -= mm(hauteurLigne(l));
      entites += entiteTexteGauche([x0 + pad, curY], mm(hauteurLigne(l)), l.texte, COUCHE_CARTOUCHE, couleurAccent(l));
      curY -= mm(1.5);
    }
  }

  return insererDansEntites(dxfOriginal, entites);
}

/** Une valeur de groupe DXF tient sur une seule ligne : un retour à la ligne dans un texte saisi par un humain casserait l'appariement code/valeur du reste du fichier. */
function dxfSafe(texte: string): string {
  return texte.replace(/[\r\n]+/g, " ").trim();
}

function g(code: number, valeur: string | number): string {
  return `${code}\n${valeur}\n`;
}

/** TEXTE centré horizontalement ET verticalement sur `point` (convention DXF : 72=1/73=2, point d'alignement 11/21 dupliqué sur 10/20). */
function entiteTexteCentre(point: Point, hauteur: number, texte: string, calque: string, couleur?: number): string {
  const px = point[0].toFixed(2);
  const py = point[1].toFixed(2);
  return (
    g(0, "TEXT") +
    g(8, calque) +
    (couleur !== undefined ? g(62, couleur) : "") +
    g(10, px) +
    g(20, py) +
    g(40, hauteur.toFixed(2)) +
    g(1, dxfSafe(texte)) +
    g(72, 1) +
    g(73, 2) +
    g(11, px) +
    g(21, py)
  );
}

/** TEXTE justifié à gauche (justification par défaut : le point 10/20 est le coin bas-gauche du texte). */
function entiteTexteGauche(point: Point, hauteur: number, texte: string, calque: string, couleur?: number): string {
  return (
    g(0, "TEXT") +
    g(8, calque) +
    (couleur !== undefined ? g(62, couleur) : "") +
    g(10, point[0].toFixed(2)) +
    g(20, point[1].toFixed(2)) +
    g(40, hauteur.toFixed(2)) +
    g(1, dxfSafe(texte))
  );
}

/** Petite croix centrée sur `point` (deux LINE) — marque visuellement où le centroïde a été mesuré. */
function entiteCroix(point: Point, demiTaille: number, calque: string): string {
  const [x, y] = point;
  const ligne = (x1: number, y1: number, x2: number, y2: number) =>
    g(0, "LINE") + g(8, calque) + g(10, x1.toFixed(2)) + g(20, y1.toFixed(2)) + g(11, x2.toFixed(2)) + g(21, y2.toFixed(2));
  return ligne(x - demiTaille, y, x + demiTaille, y) + ligne(x, y - demiTaille, x, y + demiTaille);
}

/**
 * Rectangle plein (filled) via SOLID — ordre de sommets p1,p2,p3,p4
 * SPÉCIFIQUE à cette entité (p3/p4 = bord opposé dans le MÊME sens que p1/p2,
 * jamais la suite du périmètre) : sinon le quadrilatère se dessine en
 * « nœud papillon » au lieu d'un rectangle plein. Convention documentée
 * AutoCAD, reproduite ici sans s'y tromper.
 */
function entiteSolide(x0: number, y0: number, x1: number, y1: number, calque: string): string {
  return (
    g(0, "SOLID") +
    g(8, calque) +
    g(10, x0.toFixed(2)) +
    g(20, y0.toFixed(2)) +
    g(11, x1.toFixed(2)) +
    g(21, y0.toFixed(2)) +
    g(12, x0.toFixed(2)) +
    g(22, y1.toFixed(2)) +
    g(13, x1.toFixed(2)) +
    g(23, y1.toFixed(2))
  );
}

/** Rectangle (contour) via POLYLINE/VERTEX/SEQEND — jamais LWPOLYLINE (AC1014+, absente des fichiers AC1009 réels qu'on annote). */
function entiteRectangle(x0: number, y0: number, x1: number, y1: number, calque: string): string {
  const sommets: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  let out = g(0, "POLYLINE") + g(8, calque) + g(66, 1) + g(70, 1); // 66 : suivi de VERTEX ; 70 bit0 : fermée
  for (const [x, y] of sommets) {
    out += g(0, "VERTEX") + g(8, calque) + g(10, x.toFixed(2)) + g(20, y.toFixed(2));
  }
  return out + g(0, "SEQEND");
}

/**
 * QR dessiné module par module en rectangles vectoriels pleins (SOLID),
 * jamais collé en image : même convention que les étiquettes de sacs de
 * déchets (waste-bag-label.ts) — un lecteur/traceur reste net à toute
 * résolution, une image serait rééchantillonnée. Les modules noirs
 * consécutifs d'une même rangée sont fusionnés en un seul rectangle
 * (moins d'entités, pas de liseré de jointure).
 */
function dessinerQr(url: string, x0: number, y0: number, taille: number, calque: string): string {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const tailleModule = taille / count;
  let out = "";
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const debut = col;
      while (col < count && qr.modules.get(row, col)) col++;
      // Rangée 0 = haut du symbole (lecture normale) : l'axe Y du DXF
      // pointant vers le haut, contrairement à une image, la rangée 0 se
      // place donc près du HAUT du carré, pas du bas.
      const yHaut = y0 + taille - row * tailleModule;
      out += entiteSolide(x0 + debut * tailleModule, yHaut - tailleModule, x0 + col * tailleModule, yHaut, calque);
    }
  }
  return out;
}

/**
 * Insère `nouvellesEntites` juste avant la fin de la section ENTITIES DU
 * DESSIN RACINE (pas celle, antérieure, de BLOCKS) : repère le marqueur
 * « 0/SECTION puis 2/ENTITIES », puis cherche SON PROPRE « 0/ENDSEC » à
 * partir de là — jamais le premier ENDSEC du fichier, qui pourrait clore
 * BLOCKS sur les tracés qui posent leurs pièces via BLOCK/INSERT.
 */
function insererDansEntites(dxfOriginal: string, nouvellesEntites: string): { dxf: string } | { error: string } {
  // Les codes de groupe d'un DXF écrit par AutoCAD/Modaris sont justifiés à
  // droite dans un champ (ex. "  0", pas "0") — constaté sur les tracés
  // réels du module. `[ \t]*` tolère cette mise en forme (et son absence :
  // un DXF généré sans ce padding, comme nos propres fichiers de test, reste
  // reconnu).
  const marqueur = /[ \t]*0[ \t]*\r?\n[ \t]*SECTION[ \t]*\r?\n[ \t]*2[ \t]*\r?\n[ \t]*ENTITIES[ \t]*\r?\n/;
  const debut = marqueur.exec(dxfOriginal);
  if (!debut) return { error: "Section ENTITIES introuvable : ce DXF ne peut pas être marqué." };

  const departRecherche = debut.index + debut[0].length;
  const finEndsec = dxfOriginal.slice(departRecherche).search(/[ \t]*0[ \t]*\r?\n[ \t]*ENDSEC[ \t]*\r?\n/);
  if (finEndsec < 0) return { error: "Fin de la section ENTITIES introuvable : ce DXF ne peut pas être marqué." };

  const pointInsertion = departRecherche + finEndsec;
  return { dxf: dxfOriginal.slice(0, pointInsertion) + nouvellesEntites + dxfOriginal.slice(pointInsertion) };
}
