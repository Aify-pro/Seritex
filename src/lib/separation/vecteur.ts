/**
 * Films vectoriels : au lieu d'un masque 1 bit (pixels visibles dès qu'on
 * zoome, points de trame en escalier), chaque écran devient des tracés PDF.
 *
 *  - Aplats et zones pleines : contours du masque suivis le long des pixels
 *    puis lissés (coins arrondis de moins d'un pixel, escaliers adoucis).
 *  - Trame AM : un VRAI point par cellule de la trame (rond, elliptique ou
 *    ligne), d'aire exacte égale au ton de la cellule, à l'angle de l'écran,
 *    quelle que soit la résolution du film. Au-delà du contact des points, la
 *    forme est le point agrandi découpé par la cellule (damier, chaînes).
 *
 * Fonctions pures, sans DOM : appelées par le Web Worker (ecrans.ts) et le
 * banc de test. Les coordonnées sont en pixels du film (y vers le bas) ;
 * films.ts les met à l'échelle du PDF.
 */
import type { FormePoint, ReglageAM } from "./trame";

/** Un écran en vectoriel : zones pleines + points de trame (gabarits réutilisés). */
export type EcranVecteur = {
  /** Opérateurs de tracé (m l c h) des zones pleines, en pixels ; vide si aucune. */
  chemin: string;
  /** Un gabarit de point par niveau de ton utilisé, centré sur l'origine, en pixels. */
  gabarits: { niveau: number; chemin: string }[];
  /** Positions des points : triplets (niveau, x, y) en pixels. */
  points: Float32Array;
};

/** Niveaux de ton des points (1 % d'aire d'écart) : un gabarit PDF par niveau utilisé. */
export const NIVEAUX = 100;
/** Débord des côtés d'une cellule pleine (fraction de cellule) : pas de filet blanc entre cellules voisines. */
const DEBORD = 0.004;
/** Garde-fou de taille : au-delà, le film reste en image 1 bit. */
export const POINTS_MAX = 1_500_000;
export const CHEMIN_MAX = 60_000_000;

const nombre = (v: number) => {
  const s = v.toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s.endsWith("0") ? s.slice(0, -1) : s;
};

/* ------------------------------------------------------------------------ */
/* Contours d'un masque                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Contours d'un masque 0/1 : suite fermée de coins (x0, y0, x1, y1…) en
 * coordonnées de coins de pixels. Les contours extérieurs et les trous
 * tournent en sens opposés : un remplissage « nonzero » évide les trous.
 */
export function contoursMasque(m: Uint8Array, w: number, h: number): number[][] {
  const W1 = w + 1;
  // Directions : 0 droite, 1 bas, 2 gauche, 3 haut. Pixel rempli à droite de la marche.
  const sortant = new Uint8Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (y === 0 || !m[(y - 1) * w + x]) sortant[y * W1 + x] |= 1; // haut : (x,y) -> (x+1,y)
      if (x === w - 1 || !m[y * w + x + 1]) sortant[y * W1 + x + 1] |= 2; // droite : (x+1,y) -> (x+1,y+1)
      if (y === h - 1 || !m[(y + 1) * w + x]) sortant[(y + 1) * W1 + x + 1] |= 4; // bas : (x+1,y+1) -> (x,y+1)
      if (x === 0 || !m[y * w + x - 1]) sortant[(y + 1) * W1 + x] |= 8; // gauche : (x,y+1) -> (x,y)
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const boucles: number[][] = [];
  // Au carrefour : tourner à droite d'abord (sépare deux pixels en diagonale), puis tout droit, puis à gauche.
  const choisir = (s: number, dir: number) => [(dir + 1) & 3, dir, (dir + 3) & 3].find((k) => s & (1 << k));
  for (let depart = 0; depart < sortant.length; depart++) {
    while (sortant[depart]) {
      let d = 0;
      while (!(sortant[depart] & (1 << d))) d++;
      const coins: number[] = [];
      let v = depart;
      let dir = d;
      let premiere = true;
      let dirFin = d;
      for (;;) {
        // L'arête de départ reste marquée jusqu'à la fermeture : on y revient pour reconnaître la boucle fermée.
        if (!premiere) sortant[v] &= ~(1 << dir);
        premiere = false;
        v = (Math.floor(v / W1) + DY[dir]) * W1 + (v % W1) + DX[dir];
        const suivant = choisir(sortant[v], dir);
        if (v === depart && suivant === d) {
          dirFin = dir;
          break;
        }
        if (suivant === undefined) throw new Error("contour ouvert");
        if (suivant !== dir) coins.push(v % W1, Math.floor(v / W1));
        dir = suivant;
      }
      sortant[depart] &= ~(1 << d);
      if (dirFin !== d) coins.unshift(depart % W1, Math.floor(depart / W1));
      if (coins.length >= 8) boucles.push(coins);
    }
  }
  return boucles;
}

/**
 * Tracé lissé d'un contour : les arêtes restent droites, chaque coin est
 * arrondi par une courbe d'au plus `rayon` pixel (moins si l'arête est
 * courte). Un coin franc du dessin reste donc franc à l'échelle du film.
 */
export function cheminContour(boucle: number[], rayon = 1): string {
  const n = boucle.length / 2;
  if (n < 3) return "";
  const pt = (i: number) => [boucle[((i + n) % n) * 2], boucle[((i + n) % n) * 2 + 1]] as const;
  const out: string[] = [];
  let premier = true;
  for (let i = 0; i < n; i++) {
    const [px, py] = pt(i - 1);
    const [cx, cy] = pt(i);
    const [nx, ny] = pt(i + 1);
    const lp = Math.hypot(cx - px, cy - py);
    const ln = Math.hypot(nx - cx, ny - cy);
    const d = Math.min(rayon, lp / 2, ln / 2);
    const ux = (cx - px) / lp;
    const uy = (cy - py) / lp;
    const vx = (nx - cx) / ln;
    const vy = (ny - cy) / ln;
    const ax = cx - ux * d;
    const ay = cy - uy * d;
    const bx = cx + vx * d;
    const by = cy + vy * d;
    if (premier) {
      out.push(`${nombre(ax)} ${nombre(ay)} m`);
      premier = false;
    } else out.push(`${nombre(ax)} ${nombre(ay)} l`);
    // Courbe quadratique (a, coin, b) écrite en cubique.
    out.push(
      `${nombre(ax + (2 / 3) * (cx - ax))} ${nombre(ay + (2 / 3) * (cy - ay))} ${nombre(bx + (2 / 3) * (cx - bx))} ${nombre(by + (2 / 3) * (cy - by))} ${nombre(bx)} ${nombre(by)} c`,
    );
  }
  out.push("h");
  return out.join("\n");
}

/** Zones pleines d'un masque en tracé vectoriel ; null si le tracé dépasse la taille raisonnable. */
export function cheminMasque(m: Uint8Array, w: number, h: number, rayon = 1): string | null {
  const parties: string[] = [];
  let taille = 0;
  for (const b of contoursMasque(m, w, h)) {
    const c = cheminContour(b, rayon);
    taille += c.length;
    if (taille > CHEMIN_MAX) return null;
    parties.push(c);
  }
  return parties.join("\n");
}

/* ------------------------------------------------------------------------ */
/* Points de trame                                                          */
/* ------------------------------------------------------------------------ */

type Seg = { op: "m" | "l" | "c"; p: number[] };

/** Rapport des demi-axes (v / u) de l'ellipse de chaque forme ; la ligne est traitée à part. */
const RAPPORT: Record<FormePoint, number> = { rond: 1, elliptique: Math.sqrt(0.45), ligne: 1 };

/** Aire de l'ellipse de demi-axes (R, R·s) découpée par la cellule [-½, ½]². */
function aireEllipse(R: number, s: number) {
  const pas = 400;
  let a = 0;
  for (let i = 0; i < pas; i++) {
    const u = ((i + 0.5) / pas) * 0.5;
    if (u >= R) break;
    a += Math.min(0.5, R * s * Math.sqrt(1 - (u / R) ** 2));
  }
  return (4 * a * 0.5) / pas;
}

const rayons = new Map<FormePoint, Float64Array>();

/** Rayon R pour chaque niveau de ton (aire = niveau / NIVEAUX), par dichotomie, mis en cache. */
function rayonsForme(forme: FormePoint): Float64Array {
  let t = rayons.get(forme);
  if (t) return t;
  t = new Float64Array(NIVEAUX + 1);
  const s = RAPPORT[forme];
  for (let n = 1; n <= NIVEAUX; n++) {
    let lo = 0;
    let hi = 1.5 / s;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (aireEllipse(mid, s) < n / NIVEAUX) lo = mid;
      else hi = mid;
    }
    t[n] = (lo + hi) / 2;
  }
  rayons.set(forme, t);
  return t;
}

/** Arc d'ellipse (centre 0, demi-axes rx, ry) de t0 à t1 (t1 > t0) en courbes de Bézier cubiques. */
function arc(rx: number, ry: number, t0: number, t1: number): Seg[] {
  const n = Math.max(1, Math.ceil((t1 - t0) / (Math.PI / 2) - 1e-9));
  const pas = (t1 - t0) / n;
  const k = (4 / 3) * Math.tan(pas / 4);
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * pas;
    const b = a + pas;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    segs.push({
      op: "c",
      p: [rx * (ca - k * sa), ry * (sa + k * ca), rx * (cb + k * sb), ry * (sb - k * cb), rx * cb, ry * sb],
    });
  }
  return segs;
}

const DEUX_PI = Math.PI * 2;
const norm = (t: number) => ((t % DEUX_PI) + DEUX_PI) % DEUX_PI;

/** Contour de l'ellipse (R, R·s) découpée par la boîte [-B, B]² : arcs d'ellipse et côtés de la boîte. */
function ellipseDansBoite(R: number, s: number, B: number): Seg[] {
  const rx = R;
  const ry = R * s;
  const crit: number[] = [];
  if (rx > B) {
    const t = Math.acos(B / rx);
    crit.push(norm(t), norm(-t), norm(Math.PI - t), norm(Math.PI + t));
  }
  if (ry > B) {
    const t = Math.asin(B / ry);
    crit.push(norm(t), norm(Math.PI - t), norm(-t), norm(Math.PI + t));
  }
  crit.sort((a, b) => a - b);
  if (crit.length === 0) {
    const segs = arc(rx, ry, 0, DEUX_PI);
    return [{ op: "m", p: [rx, 0] }, ...segs];
  }
  const dedans = (t: number) => Math.abs(rx * Math.cos(t)) <= B + 1e-9 && Math.abs(ry * Math.sin(t)) <= B + 1e-9;
  const arcs: [number, number][] = [];
  for (let i = 0; i < crit.length; i++) {
    const t0 = crit[i];
    let t1 = crit[(i + 1) % crit.length];
    if (t1 <= t0) t1 += DEUX_PI;
    if (t1 - t0 < 1e-9) continue;
    if (dedans((t0 + t1) / 2)) arcs.push([t0, t1]);
  }
  if (arcs.length === 0) {
    return [
      { op: "m", p: [-B, -B] },
      { op: "l", p: [B, -B] },
      { op: "l", p: [B, B] },
      { op: "l", p: [-B, B] },
    ];
  }
  const segs: Seg[] = [{ op: "m", p: [rx * Math.cos(arcs[0][0]), ry * Math.sin(arcs[0][0])] }];
  for (let i = 0; i < arcs.length; i++) {
    const [t0, t1] = arcs[i];
    segs.push(...arc(rx, ry, t0, t1));
    // Raccord le long de la boîte, dans le sens des angles croissants, jusqu'à l'arc suivant.
    const [t2] = arcs[(i + 1) % arcs.length];
    const fin = [rx * Math.cos(t1), ry * Math.sin(t1)];
    const debut = [rx * Math.cos(t2), ry * Math.sin(t2)];
    const a0 = norm(Math.atan2(fin[1], fin[0]));
    let a1 = norm(Math.atan2(debut[1], debut[0]));
    if (a1 <= a0) a1 += DEUX_PI;
    for (const coin of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4, (9 * Math.PI) / 4, (11 * Math.PI) / 4]) {
      if (coin > a0 + 1e-9 && coin < a1 - 1e-9) segs.push({ op: "l", p: [B * Math.sign(Math.cos(coin)), B * Math.sign(Math.sin(coin))] });
    }
    if (i < arcs.length - 1 || arcs.length > 1) segs.push({ op: "l", p: debut });
  }
  return segs;
}

/** Contour (cellule de côté 1, centrée) d'un point couvrant la fraction `niveau / NIVEAUX` de la cellule. */
export function contourPoint(forme: FormePoint, niveau: number): Seg[] {
  const B = 0.5 + DEBORD;
  if (niveau >= NIVEAUX) {
    return [
      { op: "m", p: [-B, -B] },
      { op: "l", p: [B, -B] },
      { op: "l", p: [B, B] },
      { op: "l", p: [-B, B] },
    ];
  }
  if (forme === "ligne") {
    const e = niveau / NIVEAUX / 2;
    return [
      { op: "m", p: [-B, -e] },
      { op: "l", p: [B, -e] },
      { op: "l", p: [B, e] },
      { op: "l", p: [-B, e] },
    ];
  }
  return ellipseDansBoite(rayonsForme(forme)[niveau], RAPPORT[forme], B);
}

/** Gabarit d'un point en pixels : le contour de la cellule tourné à l'angle de l'écran et mis à l'échelle de la cellule. */
function gabarit(forme: FormePoint, niveau: number, pas: number, angleRad: number) {
  const cos = Math.cos(angleRad) * pas;
  const sin = Math.sin(angleRad) * pas;
  const xy = (u: number, v: number) => `${nombre(cos * u - sin * v)} ${nombre(sin * u + cos * v)}`;
  const lignes = contourPoint(forme, niveau).map((s) => {
    if (s.op === "c") return `${xy(s.p[0], s.p[1])} ${xy(s.p[2], s.p[3])} ${xy(s.p[4], s.p[5])} c`;
    return `${xy(s.p[0], s.p[1])} ${s.op}`;
  });
  return `${lignes.join("\n")}\nh`;
}

/**
 * Trame AM d'un écran en vectoriel. Le ton de chaque cellule est la moyenne
 * des tons de ses pixels ; les pixels « pleins » (ton ≥ point max) sont
 * tracés en zone pleine (contour lissé) et ne comptent pas dans les points,
 * pour ne pas grossir deux fois le bord d'un aplat.
 */
export function ecranAMVecteur(tonDe: (p: number) => number, w: number, h: number, r: ReglageAM): EcranVecteur | null {
  const pas = r.ppp / r.lpi; // côté d'une cellule en pixels
  const c = 1 / pas;
  const rad = (r.angle * Math.PI) / 180;
  const a = Math.cos(rad) * c;
  const b = Math.sin(rad) * c;
  const min = Math.round((r.pointMinPct / 100) * 255);
  const max = Math.round((r.pointMaxPct / 100) * 255);
  const plein = new Uint8Array(w * h);

  // Grille des cellules couvrant l'image.
  const coins = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ].map(([x, y]) => [x * a + y * b, y * a - x * b]);
  const i0 = Math.floor(Math.min(...coins.map((q) => q[0]))) - 1;
  const j0 = Math.floor(Math.min(...coins.map((q) => q[1]))) - 1;
  const ni = Math.floor(Math.max(...coins.map((q) => q[0]))) + 2 - i0;
  const nj = Math.floor(Math.max(...coins.map((q) => q[1]))) + 2 - j0;
  const somme = new Float32Array(ni * nj);
  let aPlein = false;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const t = tonDe(p);
      if (t <= 0) continue;
      if (t >= max) {
        plein[p] = 1;
        aPlein = true;
        continue;
      }
      const u = (x + 0.5) * a + (y + 0.5) * b;
      const v = (y + 0.5) * a - (x + 0.5) * b;
      somme[(Math.floor(v) - j0) * ni + (Math.floor(u) - i0)] += t > 255 ? 255 : t;
    }
  }

  const aireCellule = pas * pas;
  const utilises = new Map<number, string>();
  const pts: number[] = [];
  const c2 = a * a + b * b;
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const s = somme[j * ni + i];
      if (s <= 0) continue;
      const ton = s / aireCellule; // ton moyen 0 à 255
      if (ton < min) continue;
      const niveau = ton >= max ? NIVEAUX : Math.max(1, Math.min(NIVEAUX - 1, Math.round((ton / 255) * NIVEAUX)));
      const U = i0 + i + 0.5;
      const V = j0 + j + 0.5;
      const x = (a * U - b * V) / c2;
      const y = (b * U + a * V) / c2;
      if (x < -pas || y < -pas || x > w + pas || y > h + pas) continue;
      pts.push(niveau, x, y);
      if (pts.length / 3 > POINTS_MAX) return null;
      if (!utilises.has(niveau)) utilises.set(niveau, gabarit(r.forme, niveau, pas, rad));
    }
  }
  let chemin = "";
  if (aPlein) {
    const c0 = cheminMasque(plein, w, h);
    if (c0 === null) return null;
    chemin = c0;
  }
  return { chemin, gabarits: [...utilises].map(([niveau, ch]) => ({ niveau, chemin: ch })), points: Float32Array.from(pts) };
}

/** Écran d'aplats (ou de blancs) en vectoriel : contours lissés du masque ; null si trop volumineux. */
export function ecranMasqueVecteur(m: Uint8Array, w: number, h: number): EcranVecteur | null {
  const chemin = cheminMasque(m, w, h);
  if (chemin === null) return null;
  return { chemin, gabarits: [], points: new Float32Array(0) };
}
