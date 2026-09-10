import "server-only";
import DxfParser, {
  IBlock,
  IEntity,
  IInsertEntity,
  ILwpolylineEntity,
  IPolylineEntity,
} from "dxf-parser";
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
 * Point de base d'un bloc AutoCAD : les coordonnées des entités d'un bloc
 * sont exprimées relativement à ce point, avant application du placement de
 * l'INSERT (cf. resolveInsert ci-dessous).
 */
function blockBasePoint(block: IBlock): Point {
  return [block.position?.x ?? 0, block.position?.y ?? 0];
}

/**
 * Transforme les points d'une entité d'un bloc selon le placement décrit par
 * son INSERT : retrait du point de base du bloc, mise à l'échelle (X/Y),
 * rotation (degrés), puis translation au point d'insertion — ordre standard
 * DXF. `xScale`/`yScale`/`rotation` sont absents des codes groupe quand ils
 * valent leur défaut (1, 1, 0) ; dxf-parser les remonte alors `undefined`.
 */
function resolveInsertPoint([x, y]: Point, base: Point, insert: IInsertEntity): Point {
  const sx = insert.xScale ?? 1;
  const sy = insert.yScale ?? 1;
  const angle = ((insert.rotation ?? 0) * Math.PI) / 180;
  const lx = (x - base[0]) * sx;
  const ly = (y - base[1]) * sy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;
  return [rx + (insert.position?.x ?? 0), ry + (insert.position?.y ?? 0)];
}

/** Extrait les contours LWPOLYLINE/POLYLINE bruts d'une liste d'entités, en appliquant un éventuel repère de transformation (résolution de bloc). */
function extractRawContours(entities: IEntity[], transform?: (p: Point) => Point): DxfContour[] {
  const out: DxfContour[] = [];
  for (const entity of entities) {
    if (entity.type !== "LWPOLYLINE" && entity.type !== "POLYLINE") continue;
    const poly = entity as ILwpolylineEntity | IPolylineEntity;
    const layer: string = poly.layer ?? "0";
    if (NOISE_LAYER_PATTERN.test(layer)) continue;

    const rawVertices = poly.vertices ?? [];
    if (rawVertices.length < MIN_VERTICES) continue;

    const points: Point[] = rawVertices.map((v) => {
      const p: Point = [v.x, v.y];
      return transform ? transform(p) : p;
    });
    out.push({ layer, points });
  }
  return out;
}

/**
 * Résout les entités INSERT en aplatissant les entités du bloc référencé
 * (dxf.blocks) dans le repère du tracé — convention d'export utilisée par
 * certains logiciels de placement (une pièce = un bloc nommé, une INSERT par
 * exemplaire posé). Une seule profondeur de résolution (un bloc contenant
 * lui-même une INSERT n'est pas déplié) : aucun fichier examiné n'en a eu
 * besoin. Un bloc introuvable est ignoré (jamais d'exception qui ferait
 * échouer tout le tracé pour une seule pièce mal référencée).
 */
function resolveInsertContours(entities: IEntity[], blocks: Record<string, IBlock> | undefined): DxfContour[] {
  if (!blocks) return [];
  const out: DxfContour[] = [];
  for (const entity of entities) {
    if (entity.type !== "INSERT") continue;
    const insert = entity as IInsertEntity;
    const block = blocks[insert.name];
    if (!block?.entities) continue;
    const base = blockBasePoint(block);
    out.push(...extractRawContours(block.entities, (p) => resolveInsertPoint(p, base, insert)));
  }
  return out;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundingBox(points: Point[]): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxArea(b: BBox): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function bboxOverlapArea(a: BBox, b: BBox): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Un contour de coupe (surplus de couture inclus) et le ou les contours
 * imbriqués à l'intérieur (ligne nette, détails internes — dart, cran,
 * repère de pince) partagent quasiment le même emplacement dans le plan :
 * leurs boîtes englobantes se recouvrent presque entièrement. Vérifié sur
 * les fichiers réels du module : chaque pièce y est systématiquement
 * exportée en plusieurs contours imbriqués. Confirmé par le métier (cf.
 * rapport du module) : seul le contour externe (le plus grand) définit où
 * couper le tissu — les contours qu'il enveloppe sont des valeurs de
 * couture, jamais des pièces à reconnaître en tant que telles.
 *
 * Regroupe donc les contours par chevauchement de boîte englobante
 * (indépendant du nom de calque : fonctionne aussi bien sur un patron
 * unitaire, tout sur un seul calque, que sur un tracé de placement dont les
 * contours sont éclatés sur des calques numériques sans convention de
 * nommage) et ne garde que le plus grand contour de chaque groupe.
 *
 * Limite connue : deux pièces DISTINCTES imbriquées l'une dans l'autre à
 * dessein (nesting « gigogne » poussé, bord à bord sans marge) pourraient en
 * théorie être fusionnées à tort par ce critère — non observé sur les
 * fichiers réels examinés (tracés de coupe textile, marge de découpe
 * conservée entre pièces).
 */
const NESTED_OVERLAP_RATIO = 0.6;

function keepOnlyOuterContours(contours: DxfContour[]): DxfContour[] {
  const n = contours.length;
  if (n <= 1) return contours;

  const boxes = contours.map((c) => boundingBox(c.points));
  const areas = contours.map((c) => polygonArea(c.points));
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const minArea = Math.min(bboxArea(boxes[i]), bboxArea(boxes[j]));
      if (minArea <= 0) continue;
      if (bboxOverlapArea(boxes[i], boxes[j]) / minArea > NESTED_OVERLAP_RATIO) union(i, j);
    }
  }

  const largestByGroup = new Map<number, number>(); // racine -> index du contour de plus grande aire
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const current = largestByGroup.get(root);
    if (current === undefined || areas[i] > areas[current]) largestByGroup.set(root, i);
  }

  return Array.from(largestByGroup.values())
    .sort((a, b) => a - b)
    .map((i) => contours[i]);
}

/**
 * Parse un buffer DXF et retourne les contours de coupe détectés : un par
 * pièce, en excluant les calques reconnus comme non porteurs de contour de
 * découpe, les fragments trop petits pour être une pièce réelle, et les
 * contours imbriqués (valeurs de couture, détails internes) au profit du
 * seul contour externe de chaque pièce.
 *
 * Deux conventions d'export sont prises en charge : entités LWPOLYLINE/
 * POLYLINE directement au niveau racine du tracé, et pièces posées via des
 * entités INSERT référençant un bloc nommé (dxf.blocks) — convention
 * observée sur des tracés de placement réels du module.
 *
 * Limite connue : les arcs/bulges sont traités comme des segments droits
 * (pas d'interpolation de courbe), et les contours composés d'entités LINE
 * séparées (non chaînées en une seule polyligne) ne sont pas reconstruits —
 * non nécessaire sur les fichiers réels examinés à ce jour.
 */
export function parseDxfContours(dxfText: string): DxfContour[] {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf?.entities) return [];

  const raw = [
    ...extractRawContours(dxf.entities as IEntity[]),
    ...resolveInsertContours(dxf.entities as IEntity[], dxf.blocks),
  ];

  const candidates = raw
    .map((c) => ({ ...c, area: polygonArea(c.points) }))
    .filter((c) => c.area >= MIN_ABSOLUTE_AREA);
  if (candidates.length === 0) return [];

  const maxArea = Math.max(...candidates.map((c) => c.area));
  const filtered = candidates
    .filter((c) => c.area >= maxArea * MIN_RELATIVE_AREA)
    .map(({ layer, points }) => ({ layer, points }));

  return keepOnlyOuterContours(filtered);
}
