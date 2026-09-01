import "server-only";
import DxfParser, { IEntity, ILwpolylineEntity, IPolylineEntity } from "dxf-parser";
import type { Point } from "@/lib/patronnage/geometry";
import { polygonArea } from "@/lib/patronnage/geometry";

export interface DxfContour {
  layer: string;
  points: Point[];
}

/**
 * Calques présumés ne pas porter de contour de découpe (crans, droit-fil,
 * repères, texte d'annotation). Heuristique de départ par nom de calque —
 * à affiner une fois des fichiers réels examinés (cf. rapport du module).
 * Un contour sur un calque non reconnu par cette liste est conservé : mieux
 * vaut proposer une pièce en trop à exclure manuellement à l'écran de
 * validation qu'en oublier une silencieusement.
 */
const NOISE_LAYER_PATTERN = /rep[eè]re|cran|texte|text|droit.?fil|axe|notch|label|annotation|cote/i;

const MIN_VERTICES = 3;

/**
 * Filtre des fragments : RELATIF à la plus grande pièce du fichier, pas
 * absolu. Un seuil absolu (ex. 0,5 unité²) éliminait silencieusement toutes
 * les pièces d'un fichier exporté en petite unité (ex. mètres : facteur
 * ×0,01, aires divisées par 10 000) AVANT que la pré-passe d'échelle n'ait
 * pu corriger le fichier — le tracé remontait alors « aucun contour
 * exploitable » au lieu d'être corrigé. Avec un seuil relatif, l'ordre de
 * grandeur du fichier n'a aucune influence : on n'écarte que les fragments
 * dégénérés (≥ ~1000× plus petits en dimension linéaire que la plus grande
 * pièce), quelle que soit l'unité d'export.
 */
const MIN_RELATIVE_AREA = 1e-6; // par rapport à l'aire de la plus grande pièce
const MIN_ABSOLUTE_AREA = 1e-9; // écarte uniquement les contours dégénérés (aire ~0)

/**
 * Parse un buffer DXF et retourne les contours fermés détectés, en excluant
 * les calques reconnus comme non porteurs de contour de coupe et les
 * fragments trop petits pour être une pièce réelle.
 *
 * Limite connue : seules les entités LWPOLYLINE et POLYLINE sont prises en
 * compte ; les arcs/bulges sont traités comme des segments droits (pas
 * d'interpolation de courbe), et les contours composés de LINE séparées
 * (non chaînées en une seule polyligne) ne sont pas reconstruits. À valider
 * sur de vrais fichiers — voir rapport du module.
 */
export function parseDxfContours(dxfText: string): DxfContour[] {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf?.entities) return [];

  const candidates: (DxfContour & { area: number })[] = [];

  for (const entity of dxf.entities as IEntity[]) {
    if (entity.type !== "LWPOLYLINE" && entity.type !== "POLYLINE") continue;
    const poly = entity as ILwpolylineEntity | IPolylineEntity;
    const layer: string = poly.layer ?? "0";
    if (NOISE_LAYER_PATTERN.test(layer)) continue;

    const rawVertices = poly.vertices ?? [];
    if (rawVertices.length < MIN_VERTICES) continue;

    const points: Point[] = rawVertices.map((v) => [v.x, v.y] as Point);
    const area = polygonArea(points);
    if (area < MIN_ABSOLUTE_AREA) continue;

    candidates.push({ layer, points, area });
  }

  if (candidates.length === 0) return [];

  const maxArea = Math.max(...candidates.map((c) => c.area));
  return candidates
    .filter((c) => c.area >= maxArea * MIN_RELATIVE_AREA)
    .map(({ layer, points }) => ({ layer, points }));
}
