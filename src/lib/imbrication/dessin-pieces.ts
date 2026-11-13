import DxfParser, { type IBlock, type IEntity, type IInsertEntity, type ILineEntity, type IPolylineEntity, type ILwpolylineEntity } from "dxf-parser";

/**
 * Dessin COMPLET d'une pièce dans son gabarit de référence : en plus de la
 * ligne de coupe (que le moteur place), les crans, la ligne de couture et les
 * autres traits du patron, pour que le tracé produit par Seritex les porte
 * comme un tracé Modaris / Diamino (la table de coupe en a besoin pour
 * cranter).
 *
 * Dans les gabarits Modaris (AAMA, AC1009), une pièce = un BLOC inséré sur
 * la feuille. On retrouve le bloc de la pièce par sa ligne de coupe (même
 * emprise, au centième de millimètre près), puis on garde tous ses autres
 * traits, dans le repère du fichier (le même que celui du contour envoyé au
 * moteur : les placements s'y appliquent tels quels).
 */

export type Point = [number, number];

export interface Trait {
  calque: string;
  points: Point[];
  ferme: boolean;
}

interface Groupe {
  traits: Trait[];
}

function transformeur(base: Point, insert: IInsertEntity | null): (p: Point) => Point {
  if (!insert) return (p) => p;
  const sx = insert.xScale ?? 1;
  const sy = insert.yScale ?? 1;
  const a = ((insert.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([x, y]) => {
    const lx = (x - base[0]) * sx;
    const ly = (y - base[1]) * sy;
    return [lx * c - ly * s + (insert.position?.x ?? 0), lx * s + ly * c + (insert.position?.y ?? 0)];
  };
}

function traitsDe(entites: IEntity[], t: (p: Point) => Point): Trait[] {
  const out: Trait[] = [];
  for (const e of entites) {
    const calque = String(e.layer ?? "0");
    if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const poly = e as ILwpolylineEntity | IPolylineEntity;
      const pts = (poly.vertices ?? []).map((v) => t([v.x, v.y]));
      if (pts.length >= 2) out.push({ calque, points: pts, ferme: poly.shape === true });
    } else if (e.type === "LINE") {
      const l = e as ILineEntity;
      const v = l.vertices ?? [];
      if (v.length === 2) out.push({ calque, points: [t([v[0].x, v[0].y]), t([v[1].x, v[1].y])], ferme: false });
    }
  }
  return out;
}

/** Groupes de traits du fichier : un par INSERT (une pièce), plus les entités posées directement. */
function groupesDuFichier(texte: string): Groupe[] {
  const dxf = new DxfParser().parseSync(texte);
  if (!dxf) return [];
  const blocs: Record<string, IBlock> = dxf.blocks ?? {};
  const groupes: Groupe[] = [];
  const directes: IEntity[] = [];
  for (const e of dxf.entities ?? []) {
    if (e.type === "INSERT") {
      const ins = e as IInsertEntity;
      const bloc = blocs[ins.name];
      if (!bloc?.entities) continue;
      groupes.push({ traits: traitsDe(bloc.entities, transformeur([bloc.position?.x ?? 0, bloc.position?.y ?? 0], ins)) });
    } else directes.push(e);
  }
  if (directes.length) groupes.push({ traits: traitsDe(directes, (p) => p) });
  return groupes;
}

function emprise(points: Point[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Traits de la pièce dont la ligne de coupe est `coupe` (unités du fichier),
 * HORS ligne de coupe elle-même (remplacée, dans le tracé, par le contour
 * placé par le moteur). Tolérance en unités du fichier (0,5 = 0,05 mm).
 * Rend [] si la pièce n'est pas retrouvée : le tracé portera alors la seule
 * ligne de coupe, ce qui reste un tracé juste.
 */
export function traitsDeLaPiece(texte: string, coupe: { calque: string; points: Point[] }, tolerance = 0.5): Trait[] {
  const cible = emprise(coupe.points);
  const proche = (a: ReturnType<typeof emprise>) =>
    Math.abs(a.minX - cible.minX) <= tolerance &&
    Math.abs(a.minY - cible.minY) <= tolerance &&
    Math.abs(a.maxX - cible.maxX) <= tolerance &&
    Math.abs(a.maxY - cible.maxY) <= tolerance;

  // Les entités posées directement (hors bloc) peuvent appartenir à
  // plusieurs pièces : on ne garde que les traits dans l'emprise de la pièce.
  const marge = tolerance * 2;
  const dedans = (t: Trait) =>
    t.points.every(([x, y]) => x >= cible.minX - marge && x <= cible.maxX + marge && y >= cible.minY - marge && y <= cible.maxY + marge);

  for (const g of groupesDuFichier(texte)) {
    const traits = g.traits.filter(dedans);
    const coupeGroupe = traits.filter((t) => t.calque === coupe.calque);
    if (coupeGroupe.length === 0) continue;
    if (!proche(emprise(coupeGroupe.flatMap((t) => t.points)))) continue;
    return traits.filter((t) => t.calque !== coupe.calque);
  }
  return [];
}
