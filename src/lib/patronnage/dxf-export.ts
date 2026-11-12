import "server-only";
import QRCode from "qrcode";
import { centroid, type Point } from "@/lib/patronnage/geometry";
import type { DxfContour } from "@/lib/patronnage/dxf";
import { MM_PAR_UNITE, type LignePieceDetail } from "@/lib/patronnage/detail";
import {
  construireContenuCartouche,
  libellePieceMarquee,
  mettreEnPageCartouche,
  placerCartouche,
  type CartoucheInfo,
  type LigneCartouche,
  type OrientationCartouche,
} from "@/lib/patronnage/cartouche";

export type { CartoucheInfo, OrientationCartouche };

/**
 * Génère le DXF « marqué » d'un tracé déjà déposé : texte au centre de chaque
 * patron reconnu (article, taille, pièce) et cartouche (QR + infos) au bout
 * de la longueur du tracé, tourné de 90° (jamais sous le tracé : la largeur,
 * c'est la laize), pour un document téléchargeable qui dit de lui-même à quoi il
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

// Retour utilisateur du 2026-11-11 : police des pièces trop grande (12 mm).
const HAUTEUR_TEXTE_PIECE_MM = 5;
const DEMI_CROIX_MM = 4;

const CARTOUCHE_MARGE_MM = 15; // entre le bout du tracé et le cartouche

const COULEUR_VERT = 3; // ACI — vert : tout reconnu
const COULEUR_ROUGE = 1; // ACI — rouge : au moins une pièce non reconnue


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
  // natives du fichier — cf. en-tête).
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

  // --- Marquage de chaque pièce, au centroïde de son contour BRUT. Texte
  // sans accent ni caractère spécial (rendu du traceur), police réduite.
  for (const ligne of lignes) {
    const points = contours[ligne.index]?.points;
    if (!points || points.length < 3) continue;
    const point = centroid(points);
    entites += entiteTexteCentre(point, mm(HAUTEUR_TEXTE_PIECE_MM), libellePieceMarquee(ligne), COUCHE_MARQUAGE);
    // Petite croix au centroïde exact : montre où le moteur a mesuré.
    entites += entiteCroix(point, mm(DEMI_CROIX_MM), COUCHE_MARQUAGE);
  }

  // --- Cartouche : au bout de la longueur du tracé, tourné de 90° le long de
  // la largeur, sans jamais l'élargir (cf. cartouche.ts).
  const contenu = construireContenuCartouche(lignes, info);
  const boiteMm = { minX: minX / UNITES_PAR_MM, minY: minY / UNITES_PAR_MM, maxX: maxX / UNITES_PAR_MM, maxY: maxY / UNITES_PAR_MM };
  const largeurTraceMm = Math.min(boiteMm.maxX - boiteMm.minX, boiteMm.maxY - boiteMm.minY);
  const miseEnPage = mettreEnPageCartouche(contenu, orientation, largeurTraceMm);
  const place = placerCartouche(boiteMm, miseEnPage, CARTOUCHE_MARGE_MM);
  const versFichier = (u: number, v: number): Point => {
    const [x, y] = place.versTrace(u, v);
    return [x * UNITES_PAR_MM, y * UNITES_PAR_MM];
  };
  const rectangleLocal = (u0: number, v0: number, u1: number, v1: number) => {
    const a = versFichier(u0, v0);
    const b = versFichier(u1, v1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] as const;
  };
  const couleurAccent = (accent?: LigneCartouche["accent"]) =>
    accent === "verdict_ok" ? COULEUR_VERT : accent === "verdict_ko" ? COULEUR_ROUGE : undefined;

  for (const el of miseEnPage.elements) {
    if (el.type === "cadre") {
      const [x0, y0, x1, y1] = rectangleLocal(el.u0, el.v0, el.u1, el.v1);
      entites += entiteRectangle(x0, y0, x1, y1, COUCHE_CARTOUCHE);
    } else if (el.type === "qr") {
      entites += dessinerQr(el.url, el.taille, (u0, v0, u1, v1) => {
        const [x0, y0, x1, y1] = rectangleLocal(el.u0 + u0, el.v0 + v0, el.u0 + u1, el.v0 + v1);
        return entiteSolide(x0, y0, x1, y1, COUCHE_QR);
      });
    } else if (el.centre) {
      entites += entiteTexteCentre(versFichier(el.u, el.v), mm(el.hauteur), el.texte, COUCHE_CARTOUCHE, couleurAccent(el.accent), place.rotation);
    } else {
      entites += entiteTexteGauche(versFichier(el.u, el.v), mm(el.hauteur), el.texte, COUCHE_CARTOUCHE, couleurAccent(el.accent), place.rotation);
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
function entiteTexteCentre(point: Point, hauteur: number, texte: string, calque: string, couleur?: number, rotation = 0): string {
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
    (rotation ? g(50, rotation) : "") +
    g(72, 1) +
    g(73, 2) +
    g(11, px) +
    g(21, py)
  );
}

/** TEXTE justifié à gauche (justification par défaut : le point 10/20 est le coin bas-gauche du texte). */
function entiteTexteGauche(point: Point, hauteur: number, texte: string, calque: string, couleur?: number, rotation = 0): string {
  return (
    g(0, "TEXT") +
    g(8, calque) +
    (couleur !== undefined ? g(62, couleur) : "") +
    g(10, point[0].toFixed(2)) +
    g(20, point[1].toFixed(2)) +
    g(40, hauteur.toFixed(2)) +
    g(1, dxfSafe(texte)) +
    (rotation ? g(50, rotation) : "")
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
function dessinerQr(url: string, taille: number, rectangle: (u0: number, v0: number, u1: number, v1: number) => string): string {
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
      // Rangée 0 = haut du symbole (lecture normale), dans le repère local
      // du cartouche (v vers le haut) ; la projection sur le tracé (rotation
      // éventuelle) est faite par l'appelant.
      const vHaut = taille - row * tailleModule;
      out += rectangle(debut * tailleModule, vHaut - tailleModule, col * tailleModule, vHaut);
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
