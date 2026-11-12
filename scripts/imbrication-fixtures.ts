/**
 * Pièces de test pour le moteur d'imbrication : un t-shirt (devant, dos,
 * manche gauche + droite en miroir, bord-côte d'encolure) gradué en
 * plusieurs tailles, avec des courbes (emmanchure, encolure, tête de
 * manche) discrétisées comme le ferait l'import DXF. Données synthétiques,
 * aucune donnée client.
 */
import type { EntreeImbrication } from "../src/lib/imbrication/contrat";

type Point = [number, number];

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Courbe de Bézier quadratique de a à b, contrôle c (n segments, a exclu). */
function bezier(a: Point, c: Point, b: Point, n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return pts;
}

/** Corps (devant ou dos), dessiné entier, droit-fil selon X (longueur du corps). */
export function corps(k: number, profondeurEncolure: number): Point[] {
  const L = 700 * k; // longueur
  const l = 520 * k; // largeur
  const emm = 230 * k; // hauteur d'emmanchure
  const ep = 60 * k; // retrait d'épaule
  const enc = 95 * k; // demi-largeur d'encolure
  const pts: Point[] = [[0, 0]];
  pts.push([L - emm, 0]);
  pts.push(...bezier([L - emm, 0], [L - emm * 0.25, 10 * k], [L - 20 * k, ep], 10)); // emmanchure basse
  pts.push(...bezier([L - 20 * k, ep], [L, ep + 10 * k], [L, l / 2 - enc], 6)); // épaule
  pts.push(...bezier([L, l / 2 - enc], [L - profondeurEncolure * 1.3, l / 2], [L, l / 2 + enc], 12)); // encolure
  pts.push(...bezier([L, l / 2 + enc], [L, l - ep - 10 * k], [L - 20 * k, l - ep], 6));
  pts.push(...bezier([L - 20 * k, l - ep], [L - emm * 0.25, l - 10 * k], [L - emm, l], 10));
  pts.push([0, l]);
  return pts;
}

/** Manche (gauche), tête de manche bombée, droit-fil selon X. */
export function manche(k: number): Point[] {
  const L = 220 * k;
  const l = 440 * k;
  const pts: Point[] = [[0, 30 * k], [0, l - 30 * k]];
  pts.push(...bezier([0, l - 30 * k], [L * 0.6, l], [L, l * 0.62], 10));
  pts.push(...bezier([L, l * 0.62], [L * 1.08, l * 0.45], [L * 0.75, l * 0.22], 8));
  pts.push(...bezier([L * 0.75, l * 0.22], [L * 0.4, 0], [0, 30 * k], 10));
  return pts.slice(0, -1);
}

export function bordCote(k: number): Point[] {
  return [[0, 0], [470 * k, 0], [470 * k, 45], [0, 45]];
}

export const TAILLES: Record<string, number> = { S: 0.94, M: 1, L: 1.06, XL: 1.12 };

/** Entrée complète : `paquets` t-shirts par taille, sur un tissu de `largeur` mm. */
export function entreeTshirt(options: {
  tailles: string[];
  paquets: number;
  largeur?: number;
  espacement?: number;
  tempsMaxS: number;
  graine?: number;
  effort?: number | null;
}): EntreeImbrication {
  const pieces: EntreeImbrication["pieces"] = [];
  for (const t of options.tailles) {
    const k = TAILLES[t];
    const n = options.paquets;
    pieces.push({ id: `devant-${t}`, contour: corps(k, 85 * k), quantite: n, rotations: [0, 180] });
    pieces.push({ id: `dos-${t}`, contour: corps(k, 25 * k), quantite: n, rotations: [0, 180] });
    pieces.push({ id: `manche-g-${t}`, contour: manche(k), quantite: n, rotations: [0, 180] });
    pieces.push({ id: `manche-d-${t}`, contour: manche(k), quantite: n, rotations: [0, 180], miroir: true });
    pieces.push({ id: `bord-cote-${t}`, contour: bordCote(k), quantite: n, rotations: [0, 180] });
  }
  return {
    version: "seritex.imbrication/v1",
    tissu: { largeur_utile: options.largeur ?? 1600, marge_lisiere: 5 },
    espacement: options.espacement ?? 2,
    calcul: { temps_max_s: options.tempsMaxS, graine: options.graine ?? 1, effort: options.effort ?? null },
    pieces,
  };
}

/**
 * DXF au format des gabarits Modaris examinés (AAMA/ASTM, AC1009) : une
 * pièce = un BLOC posé par INSERT à l'origine ; ligne de coupe sur le calque
 * 1 en DEUX polylignes ouvertes bout à bout ; ligne de couture fermée sur le
 * calque 14 (en retrait) ; crans sur le calque 11. Unité 0,1 mm.
 * `bulge` : ajoute un arc dans la ligne de coupe (cas refusé).
 */
export function dxfModaris(pieces: { contourMm: Point[] }[], options: { bulge?: boolean } = {}): string {
  const l: string[] = [];
  const p = (...kv: (string | number)[]) => {
    for (let i = 0; i < kv.length; i += 2) l.push(String(kv[i]).padStart(3), String(kv[i + 1]));
  };
  const polyligne = (calque: number, pts: Point[], arc = false) => {
    p(0, "POLYLINE", 8, calque, 66, 1);
    pts.forEach(([x, y], i) => {
      p(0, "VERTEX", 8, calque, 10, (x * 10).toFixed(6), 20, (y * 10).toFixed(6));
      if (arc && i === 1) p(42, "0.4");
    });
    p(0, "SEQEND", 8, calque);
  };
  p(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 0, "ENDSEC", 0, "SECTION", 2, "BLOCKS");
  pieces.forEach((piece, i) => {
    const nom = `PCE_${String(i + 1).padStart(3, "0")}`;
    p(0, "BLOCK", 8, 0, 2, nom, 70, 0, 10, 0, 20, 0);
    // Comme dans les gabarits réels, chaque pièce a sa place sur la feuille
    // (coordonnées absolues dans le bloc, INSERT à l'origine).
    const c = piece.contourMm.map(([x, y]) => [x + i * 1500, y + 300] as Point);
    const m = Math.floor(c.length / 2);
    polyligne(1, c.slice(0, m + 1), options.bulge);
    polyligne(1, [...c.slice(m), c[0]]);
    // Couture : contour réduit de 5 % autour de son centre, fermé.
    const cx = c.reduce((s, q) => s + q[0], 0) / c.length;
    const cy = c.reduce((s, q) => s + q[1], 0) / c.length;
    polyligne(14, [...c, c[0]].map(([x, y]) => [cx + (x - cx) * 0.95, cy + (y - cy) * 0.95] as Point));
    polyligne(11, [c[0], [c[0][0] + 0.4, c[0][1]]]);
    p(0, "ENDBLK", 8, 0);
  });
  p(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  pieces.forEach((_, i) => p(0, "INSERT", 8, 0, 2, `PCE_${String(i + 1).padStart(3, "0")}`, 10, 0, 20, 0, 50, 0));
  p(0, "ENDSEC", 0, "EOF");
  return l.join("\r\n") + "\r\n";
}
