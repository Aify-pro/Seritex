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
const MIN_AREA = 0.5; // unités DXF² — écarte les fragments/points quasi confondus

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

  const contours: DxfContour[] = [];

  for (const entity of dxf.entities as IEntity[]) {
    if (entity.type !== "LWPOLYLINE" && entity.type !== "POLYLINE") continue;
    const poly = entity as ILwpolylineEntity | IPolylineEntity;
    const layer: string = poly.layer ?? "0";
    if (NOISE_LAYER_PATTERN.test(layer)) continue;

    const rawVertices = poly.vertices ?? [];
    if (rawVertices.length < MIN_VERTICES) continue;

    const points: Point[] = rawVertices.map((v) => [v.x, v.y] as Point);
    if (polygonArea(points) < MIN_AREA) continue;

    contours.push({ layer, points });
  }

  return contours;
}
