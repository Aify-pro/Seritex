/**
 * H. Tests de propriétés du moteur d'imbrication (tâche I-04).
 *
 * Des jeux de pièces tirés au hasard — avec un générateur pseudo-aléatoire À
 * GRAINE FIXE écrit ici (jamais Math.random) : l'exécution est donc
 * identique d'une fois sur l'autre — sont envoyés au moteur réel
 * (WebAssembly, comme en production). Chaque tracé rendu doit vérifier, quel
 * que soit le jeu :
 *
 *  1. aucune pièce hors de la laize (marges de lisière comprises), ni avant X = 0 ;
 *  2. aucun chevauchement (tolérance ci-dessous) ;
 *  3. chaque placement selon une rotation autorisée pour sa pièce, retournement
 *     (miroir) conforme à la pièce ;
 *  4. toutes les pièces demandées posées, au bon nombre par pièce — ou bien,
 *     pour les cas volontairement impossibles, le code d'erreur prévu ;
 *  5. déterminisme : même entrée + même graine + même effort → même tracé
 *     (placements et longueur comparés exactement) sur deux exécutions.
 *
 * DEUX AVIS INDÉPENDANTS : chaque tracé passe par `validerTrace`
 * (src/lib/imbrication/validation.ts) ET par le contrôle écrit plus bas,
 * qui ne réutilise AUCUNE fonction géométrique de validation.ts
 * (transformation, intersection de segments, point dans polygone, boîte
 * englobante, distances : tout est réécrit ici, avec d'autres méthodes là où
 * c'est possible — nombre d'enroulement au lieu du lancer de rayon, points
 * témoins intérieurs en plus des sommets). Si les deux avis divergent, c'est
 * un échec.
 *
 * TOLÉRANCES (mêmes valeurs que validation.ts, recopiées et non importées
 * pour garder le second avis indépendant ; une vérification s'assure
 * qu'elles restent égales) :
 *  - TOL_CHEVAUCHEMENT_MM = 0,01 mm (= TOLERANCE_MM) : le moteur calcule en
 *    flottants 32 bits, d'où un bruit de l'ordre du millième de millimètre
 *    sur des pièces qui se touchent. Deux pièces ne « se chevauchent » que
 *    si un bord en traverse un autre avec ses deux extrémités à plus de
 *    0,01 mm de part et d'autre, ou si un point de l'une est à l'intérieur
 *    de l'autre à plus de 0,01 mm de son bord. Même tolérance pour les
 *    bords du tissu (laize, X = 0).
 *  - TOL_ESPACEMENT_MM = 0,05 mm (= TOLERANCE_ESPACEMENT_MM) : un espacement
 *    n'est manquant qu'en dessous de (espacement demandé − 0,05 mm).
 *
 * REPRODUCTIBILITÉ : le moteur n'est reproductible qu'en « mode effort »
 * (budget en itérations, `calcul.effort`) ; en mode temps il dépend de la
 * vitesse de la machine (docs/imbrication.md, « Reproductibilité et
 * budget »). Tous les calculs ici sont donc en mode effort, comme le test
 * de reproductibilité existant (section D), avec un temps maximal large
 * pour que l'arrêt soit toujours « budget_effort » (vérifié).
 */
import { imbriquer, type ResultatMoteur } from "../src/lib/imbrication/moteur";
import { TOLERANCE_ESPACEMENT_MM, TOLERANCE_MM, controlerContours, validerTrace } from "../src/lib/imbrication/validation";
import { entreeSchema, sortieSchema, type EntreeImbrication, type EntreeImbricationNormalisee, type SortieImbrication } from "../src/lib/imbrication/contrat";

type P = [number, number];
type Verifier = (nom: string, condition: boolean, detail?: unknown) => void;

export const TOL_CHEVAUCHEMENT_MM = 0.01;
export const TOL_ESPACEMENT_MM = 0.05;
/** Profondeur des points témoins intérieurs (mm), voir `pointsTemoins`. */
const PROFONDEUR_TEMOIN_MM = 0.2;

/** Graine du tirage des jeux de pièces : la changer change tous les jeux. */
export const GRAINE_TIRAGE = 20261114;
export const NB_JEUX_ALEATOIRES = 60;
/** Budget d'effort (itérations) par calcul : petit, pour tenir le temps total. */
const EFFORT = 15;
/** Temps maximal par calcul (s) : large, pour que l'arrêt soit toujours le budget d'effort. */
const TEMPS_MAX_S = 120;
/** Calculs menés en parallèle (un thread de calcul chacun). */
const PARALLELISME = 6;

// ---------------------------------------------------------------------------
// Générateur pseudo-aléatoire à graine fixe (mulberry32)
// ---------------------------------------------------------------------------

export function prng(graine: number) {
  let a = graine >>> 0;
  const suivant = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    reel: (min: number, max: number) => min + (max - min) * suivant(),
    entier: (min: number, max: number) => min + Math.floor(suivant() * (max - min + 1)),
    choix: <T>(liste: readonly T[]): T => liste[Math.floor(suivant() * liste.length)],
    vrai: (p: number) => suivant() < p,
  };
}
type Prng = ReturnType<typeof prng>;

// ---------------------------------------------------------------------------
// Générateurs de formes (convexes et concaves), arrondies au 1/1000 de mm
// ---------------------------------------------------------------------------

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const arrondir = (c: P[]): P[] => c.map(([x, y]) => [r3(x), r3(y)]);

export const FORMES = ["rectangle", "triangle", "convexe", "L", "U", "etoile", "irreguliere"] as const;
export type Forme = (typeof FORMES)[number];
const CONCAVES: Forme[] = ["L", "U", "etoile", "irreguliere"];

/** Forme dans une boîte d'environ l (selon X) × h (selon Y), coin bas-gauche en (0, 0). */
export function forme(type: Forme, l: number, h: number, g: Prng): P[] {
  switch (type) {
    case "rectangle":
      return [[0, 0], [l, 0], [l, h], [0, h]];
    case "triangle":
      return [[0, 0], [l, g.reel(0, h * 0.3)], [g.reel(0, l), h]];
    case "convexe": {
      // Points sur une ellipse à angles croissants : polygone convexe.
      const n = g.entier(5, 12);
      const angles = Array.from({ length: n }, (_, i) => ((i + g.reel(0.1, 0.9)) / n) * 2 * Math.PI);
      return angles.map((a) => [(l / 2) * (1 + Math.cos(a)), (h / 2) * (1 + Math.sin(a))]);
    }
    case "L": {
      const ex = g.reel(0.2, 0.5) * l;
      const ey = g.reel(0.2, 0.5) * h;
      return [[0, 0], [l, 0], [l, ey], [ex, ey], [ex, h], [0, h]];
    }
    case "U": {
      const e = g.reel(0.15, 0.3) * l;
      const fond = g.reel(0.2, 0.4) * h;
      return [[0, 0], [l, 0], [l, h], [l - e, h], [l - e, fond], [e, fond], [e, h], [0, h]];
    }
    case "etoile": {
      const branches = g.entier(4, 7);
      const ratio = g.reel(0.35, 0.6);
      const pts: P[] = [];
      for (let i = 0; i < 2 * branches; i++) {
        const a = (i / (2 * branches)) * 2 * Math.PI;
        const k = i % 2 === 0 ? 1 : ratio;
        pts.push([(l / 2) * (1 + k * Math.cos(a)), (h / 2) * (1 + k * Math.sin(a))]);
      }
      return pts;
    }
    case "irreguliere": {
      // Polygone étoilé autour du centre (rayons tirés au hasard) : simple, souvent concave.
      const n = g.entier(6, 14);
      const pts: P[] = [];
      for (let i = 0; i < n; i++) {
        const a = ((i + g.reel(0.2, 0.8)) / n) * 2 * Math.PI;
        const k = g.reel(0.3, 1);
        pts.push([(l / 2) * (1 + k * Math.cos(a)), (h / 2) * (1 + k * Math.sin(a))]);
      }
      return pts;
    }
  }
}

function hauteurY(c: P[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, y] of c) {
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi - lo;
}

export interface JeuAleatoire {
  nom: string;
  entree: EntreeImbrication;
  formes: Forme[];
  concave: boolean;
  paire: boolean;
  jeuxRotations: string[];
}

const JEUX_ROTATIONS: number[][] = [[0], [180], [0, 180]];
const LAIZES = [300, 450, 600, 900, 1200, 1600];

/** Tire un jeu de pièces complet (tissu, espacement, pièces, graine du moteur). */
export function tirerJeu(index: number, g: Prng): JeuAleatoire {
  const largeur = g.choix(LAIZES);
  const marge = g.choix([0, 0, 5, 10]);
  const espacement = g.choix([0, 0, 1, 2, 3]);
  const utile = largeur - 2 * marge - 2 * espacement;
  const nbTypes = g.entier(1, 4);
  const pieces: EntreeImbrication["pieces"] = [];
  const formes: Forme[] = [];
  const jeuxRotations: string[] = [];
  let paire = false;
  let total = 0;
  for (let t = 0; t < nbTypes; t++) {
    // Au moins une forme concave par jeu sur deux.
    const type: Forme = t === 0 && index % 2 === 0 ? g.choix(CONCAVES) : g.choix(FORMES);
    const h = g.reel(0.12, 0.65) * utile;
    const l = g.reel(0.1, 0.6) * Math.min(utile * 1.5, 700);
    let c = forme(type, Math.max(l, 15), Math.max(h, 15), g);
    // Garantit que la pièce tient en largeur (seules 0° et 180° : même hauteur).
    const hy = hauteurY(c);
    if (hy > utile * 0.95) c = c.map(([x, y]) => [x, (y * utile * 0.95) / hy]);
    // Repère quelconque, comme un DXF (coordonnées éloignées de l'origine).
    if (g.vrai(0.4)) {
      const dx = g.reel(-2000, 5000);
      const dy = g.reel(-2000, 5000);
      c = c.map(([x, y]) => [x + dx, y + dy]);
    }
    if (g.vrai(0.3)) c = [...c].reverse(); // sens horaire
    c = arrondir(c);
    if (g.vrai(0.2)) c = [...c, c[0]]; // contour « fermé » (dernier point = premier)
    const rotations = g.choix(JEUX_ROTATIONS);
    const quantite = g.entier(1, total > 8 ? 1 : 3);
    formes.push(type);
    jeuxRotations.push(`{${rotations.join(",")}}`);
    const id = `j${index}-p${t}-${type}`;
    if (g.vrai(0.35)) {
      // Symétrie « paire » : comme construireEntree, gauche normale + droite retournée.
      paire = true;
      pieces.push({ id: `${id}-g`, contour: c, quantite, rotations });
      pieces.push({ id: `${id}-d`, contour: c, quantite, rotations, miroir: true });
      total += 2 * quantite;
    } else {
      pieces.push({ id, contour: c, quantite, rotations, ...(g.vrai(0.1) ? { miroir: true } : {}) });
      total += quantite;
    }
  }
  return {
    nom: `jeu ${index}`,
    formes,
    concave: formes.some((f) => CONCAVES.includes(f)),
    paire,
    jeuxRotations,
    entree: {
      version: "seritex.imbrication/v1",
      tissu: { largeur_utile: largeur, marge_lisiere: marge },
      espacement,
      calcul: { temps_max_s: TEMPS_MAX_S, graine: g.entier(0, 1_000_000), effort: EFFORT },
      pieces,
    },
  };
}

// ---------------------------------------------------------------------------
// Second avis : géométrie réécrite, sans rien emprunter à validation.ts
// ---------------------------------------------------------------------------

/** Contour d'origine sans point de fermeture répété. */
function contourOuvert(c: P[]): P[] {
  const n = c.length;
  if (n > 1 && c[0][0] === c[n - 1][0] && c[0][1] === c[n - 1][1]) return c.slice(0, n - 1);
  return c;
}

/** Convention du contrat : symétrie y → -y si miroir, rotation (degrés), translation. */
function poser(c: P[], pl: { x: number; y: number; rotation: number; miroir: boolean }): P[] {
  const th = (pl.rotation / 180) * Math.PI;
  const [co, si] = [Math.cos(th), Math.sin(th)];
  const out: P[] = [];
  for (const [px, py] of c) {
    const qy = pl.miroir ? -py : py;
    out.push([pl.x + co * px - si * qy, pl.y + si * px + co * qy]);
  }
  return out;
}

interface Cadre {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
function cadre(c: P[]): Cadre {
  const xs = c.map((q) => q[0]);
  const ys = c.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const cadresDisjoints = (a: Cadre, b: Cadre, m: number) => a.x1 + m < b.x0 || b.x1 + m < a.x0 || a.y1 + m < b.y0 || b.y1 + m < a.y0;

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const vect = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
const scal = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const norme = (a: P) => Math.sqrt(scal(a, a));

/** Côté de c par rapport à la droite orientée (a → b), en mm (signé). */
function cote(a: P, b: P, c: P): number {
  const ab = sub(b, a);
  const n = norme(ab);
  return n === 0 ? norme(sub(c, a)) : vect(ab, sub(c, a)) / n;
}

/** Les segments [a,b] et [c,d] se traversent-ils franchement (au-delà de tol) ? */
function traversee(a: P, b: P, c: P, d: P, tol: number): boolean {
  const s1 = cote(a, b, c);
  const s2 = cote(a, b, d);
  const s3 = cote(c, d, a);
  const s4 = cote(c, d, b);
  return s1 * s2 < 0 && Math.abs(s1) > tol && Math.abs(s2) > tol && s3 * s4 < 0 && Math.abs(s3) > tol && Math.abs(s4) > tol;
}

function distPointSeg(p: P, a: P, b: P): number {
  const ab = sub(b, a);
  const l2 = scal(ab, ab);
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, scal(sub(p, a), ab) / l2));
  return norme(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1]]));
}

function distSegSeg(a: P, b: P, c: P, d: P): number {
  if (traversee(a, b, c, d, 0)) return 0;
  return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
}

/** Nombre d'enroulement (≠ 0 : point à l'intérieur). */
function enroulement(p: P, poly: P[]): number {
  let w = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && vect(sub(b, a), sub(p, a)) > 0) w++;
    } else if (b[1] <= p[1] && vect(sub(b, a), sub(p, a)) < 0) w--;
  }
  return w;
}

function distBord(p: P, poly: P[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distPointSeg(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

const franchementDedans = (p: P, poly: P[], tol: number) => enroulement(p, poly) !== 0 && distBord(p, poly) > tol;

/**
 * Points témoins d'une pièce : ses sommets, et pour chaque bord un point à
 * PROFONDEUR_TEMOIN_MM à l'intérieur depuis le milieu du bord (gardé
 * seulement s'il est bien intérieur). Les témoins intérieurs détectent deux
 * pièces superposées exactement (bords confondus, sommets sur les bords),
 * que les sommets seuls ne détectent pas.
 */
function pointsTemoins(poly: P[]): P[] {
  const pts: P[] = [...poly];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const n = norme(ab);
    if (n < 4 * PROFONDEUR_TEMOIN_MM) continue;
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const s of [1, -1]) {
      const q: P = [m[0] - (s * ab[1] * PROFONDEUR_TEMOIN_MM) / n, m[1] + (s * ab[0] * PROFONDEUR_TEMOIN_MM) / n];
      if (franchementDedans(q, poly, PROFONDEUR_TEMOIN_MM / 2)) {
        pts.push(q);
        break;
      }
    }
  }
  return pts;
}

export type CodeSecondAvis = "quantite" | "piece_inconnue" | "rotation" | "miroir" | "hors_largeur" | "hors_longueur" | "chevauchement" | "espacement";

export interface SecondAvis {
  codes: Set<CodeSecondAvis>;
  details: string[];
  longueur: number;
  surface: number;
  /** Plus petit écart entre une pièce et une lisière (mm), marges déduites. */
  ecartLisiereMin: number;
}

function aire(c: P[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s += vect(c[i], c[(i + 1) % c.length]);
  return Math.abs(s) / 2;
}

const angle360 = (a: number) => ((a % 360) + 360) % 360;

export function secondAvis(entree: EntreeImbricationNormalisee, sortie: SortieImbrication): SecondAvis {
  const codes = new Set<CodeSecondAvis>();
  const details: string[] = [];
  const signaler = (code: CodeSecondAvis, d: string) => {
    codes.add(code);
    if (details.length < 8) details.push(`${code}: ${d}`);
  };
  const parId = new Map(entree.pieces.map((p) => [p.id, p]));
  const nb = new Map<string, number>();
  const { largeur_utile: L, marge_lisiere: m } = entree.tissu;
  const posees: { id: string; poly: P[]; cadre: Cadre; temoins: P[] }[] = [];
  let longueur = 0;
  let surface = 0;
  let ecartLisiereMin = Infinity;
  for (const pl of sortie.placements) {
    const piece = parId.get(pl.piece_id);
    if (!piece) {
      signaler("piece_inconnue", pl.piece_id);
      continue;
    }
    nb.set(pl.piece_id, (nb.get(pl.piece_id) ?? 0) + 1);
    const r = angle360(pl.rotation);
    const ok = piece.rotations.some((a) => {
      const e = Math.abs(angle360(a) - r);
      return Math.min(e, 360 - e) < 1e-3;
    });
    if (!ok) signaler("rotation", `${pl.piece_id} à ${pl.rotation}° (autorisées ${piece.rotations.join(",")})`);
    if (pl.miroir !== (piece.miroir ?? false)) signaler("miroir", pl.piece_id);
    const base = contourOuvert(piece.contour as P[]);
    const poly = poser(base, pl);
    const c = cadre(poly);
    if (c.y0 < m - TOL_CHEVAUCHEMENT_MM || c.y1 > L - m + TOL_CHEVAUCHEMENT_MM) signaler("hors_largeur", `${pl.piece_id} y ∈ [${c.y0}, ${c.y1}]`);
    if (c.x0 < -TOL_CHEVAUCHEMENT_MM) signaler("hors_longueur", `${pl.piece_id} x0 = ${c.x0}`);
    ecartLisiereMin = Math.min(ecartLisiereMin, c.y0 - m, L - m - c.y1);
    longueur = Math.max(longueur, c.x1);
    surface += aire(base);
    posees.push({ id: pl.piece_id, poly, cadre: c, temoins: pointsTemoins(poly) });
  }
  for (const p of entree.pieces) {
    if ((nb.get(p.id) ?? 0) !== p.quantite) signaler("quantite", `${p.id} : ${nb.get(p.id) ?? 0}/${p.quantite}`);
  }
  // Toutes les paires (sans tri ni coupure : exhaustif, différent de validation.ts).
  const esp = entree.espacement;
  const portee = Math.max(esp, 0) + 1;
  for (let i = 0; i < posees.length; i++) {
    for (let j = i + 1; j < posees.length; j++) {
      const A = posees[i];
      const B = posees[j];
      if (cadresDisjoints(A.cadre, B.cadre, portee)) continue;
      let chev = false;
      let dmin = Infinity;
      for (let a = 0; a < A.poly.length && !chev; a++) {
        const a1 = A.poly[a];
        const a2 = A.poly[(a + 1) % A.poly.length];
        for (let b = 0; b < B.poly.length; b++) {
          const b1 = B.poly[b];
          const b2 = B.poly[(b + 1) % B.poly.length];
          if (traversee(a1, a2, b1, b2, TOL_CHEVAUCHEMENT_MM)) {
            chev = true;
            break;
          }
          dmin = Math.min(dmin, distSegSeg(a1, a2, b1, b2));
        }
      }
      if (!chev) {
        chev =
          A.temoins.some((q) => franchementDedans(q, B.poly, TOL_CHEVAUCHEMENT_MM)) ||
          B.temoins.some((q) => franchementDedans(q, A.poly, TOL_CHEVAUCHEMENT_MM));
      }
      if (chev) signaler("chevauchement", `${A.id} × ${B.id}`);
      else if (esp > 0 && dmin < esp - TOL_ESPACEMENT_MM) signaler("espacement", `${A.id} × ${B.id} à ${dmin.toFixed(3)} mm`);
    }
  }
  return { codes, details, longueur, surface, ecartLisiereMin };
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

async function enParallele<T, R>(elements: T[], n: number, f: (e: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(elements.length);
  let suivant = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, elements.length) }, async () => {
      while (suivant < elements.length) {
        const i = suivant++;
        res[i] = await f(elements[i], i);
      }
    })
  );
  return res;
}

const signature = (r: ResultatMoteur) =>
  r.ok ? JSON.stringify({ longueur: r.sortie.longueur, placements: r.sortie.placements }) : JSON.stringify({ code: r.code, piece: r.pieceId });

function egaliteCodes(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((c) => b.has(c));
}

interface Bilan {
  traces: number;
  echecs: Record<string, string[]>;
}

/** Vérifie un tracé valide attendu : toutes les propriétés + accord des deux avis. */
function controlerTrace(nom: string, r: ResultatMoteur, bilan: Bilan) {
  const noter = (prop: string, ok: boolean, detail: string) => {
    bilan.echecs[prop] ??= [];
    if (!ok) bilan.echecs[prop].push(`${nom} : ${detail}`);
  };
  if (!r.ok) {
    noter("calcul abouti", false, `${r.code} — ${r.message}`);
    return;
  }
  noter("calcul abouti", true, "");
  bilan.traces++;
  const avis = secondAvis(r.entree, r.sortie);
  const v = r.validation;
  const codesV = new Set(v.problemes.map((p) => p.code));
  noter("arrêt sur budget d'effort (reproductible)", r.sortie.arret === "budget_effort" && r.sortie.reproductible, `${r.sortie.arret}`);
  noter("validerTrace : tracé valide", v.valide, JSON.stringify(v.problemes.slice(0, 4)));
  noter("second avis : tracé valide", avis.codes.size === 0, avis.details.join(" | "));
  noter("deux avis d'accord (mêmes problèmes)", egaliteCodes(codesV, avis.codes), `validerTrace=[${[...codesV]}] second=[${[...avis.codes]}]`);
  noter("aucune pièce hors laize ni avant X = 0", !avis.codes.has("hors_largeur") && !avis.codes.has("hors_longueur"), avis.details.join(" | "));
  noter("aucun chevauchement", !avis.codes.has("chevauchement"), avis.details.join(" | "));
  noter("espacement entre pièces respecté", !avis.codes.has("espacement"), avis.details.join(" | "));
  noter("rotations autorisées et miroir conforme", !avis.codes.has("rotation") && !avis.codes.has("miroir"), avis.details.join(" | "));
  const attendu = r.entree.pieces.reduce((s, p) => s + p.quantite, 0);
  noter("toutes les pièces posées, bon nombre par pièce", !avis.codes.has("quantite") && r.sortie.placements.length === attendu, `${r.sortie.placements.length}/${attendu}`);
  // Le contrat promet l'espacement aussi contre les bords du tissu (contrat.ts) ;
  // validerTrace ne le contrôle pas : propriété vérifiée ici seulement.
  noter(
    "espacement respecté aussi contre les lisières (contrat)",
    avis.ecartLisiereMin >= r.entree.espacement - TOL_ESPACEMENT_MM,
    `écart min ${avis.ecartLisiereMin.toFixed(3)} mm < espacement ${r.entree.espacement} mm`
  );
  noter("longueur recalculée : deux avis égaux (±1e-6 mm)", Math.abs(avis.longueur - v.longueurMm) < 1e-6, `${avis.longueur} ≠ ${v.longueurMm}`);
  noter("longueur du moteur = longueur recalculée (±0,5 mm)", Math.abs(r.sortie.longueur - avis.longueur) < 0.5, `${r.sortie.longueur} ≠ ${avis.longueur}`);
  const utile = r.entree.tissu.largeur_utile - 2 * r.entree.tissu.marge_lisiere;
  noter("surface des pièces ≤ longueur × largeur utilisable", avis.surface <= avis.longueur * utile * (1 + 1e-9), `${avis.surface} > ${avis.longueur * utile}`);
}

// ---------------------------------------------------------------------------
// Cas volontairement impossibles (ou piégeux) : code d'erreur prévu
// ---------------------------------------------------------------------------

interface CasErreur {
  nom: string;
  entree: EntreeImbrication;
  code: string;
  pieceId?: string;
}

function casImpossibles(g: Prng): CasErreur[] {
  const calcul = { temps_max_s: TEMPS_MAX_S, graine: 5, effort: EFFORT };
  const tissu = (largeur: number, marge = 0) => ({ largeur_utile: largeur, marge_lisiere: marge });
  const cas: CasErreur[] = [];
  const rots: [string, number[]][] = [["{0}", [0]], ["{180}", [180]], ["{0,180}", [0, 180]]];
  for (const [nomR, rotations] of rots) {
    for (const type of ["rectangle", "U", "etoile"] as Forme[]) {
      const largeur = g.choix([300, 600, 1200]);
      const c = arrondir(forme(type, 200, largeur * g.reel(1.05, 1.5), g));
      cas.push({
        nom: `${type} plus large que la laize ${largeur} mm en ${nomR}`,
        entree: {
          version: "seritex.imbrication/v1",
          tissu: tissu(largeur),
          calcul,
          pieces: [
            { id: "ok", contour: forme("rectangle", 50, 50, g), quantite: 2, rotations: [0, 180] },
            { id: "trop-large", contour: c, quantite: 1, rotations },
          ],
        },
        code: "piece_trop_large",
        pieceId: "trop-large",
      });
    }
  }
  // Tient dans la largeur brute, mais plus avec marges de lisière et espacement.
  cas.push({
    nom: "pièce qui ne tient qu'en oubliant marges et espacement",
    entree: {
      version: "seritex.imbrication/v1",
      tissu: tissu(500, 10),
      espacement: 3,
      calcul,
      pieces: [{ id: "juste", contour: [[0, 0], [100, 0], [100, 476], [0, 476]], quantite: 1, rotations: [0, 180], miroir: true }],
    },
    code: "piece_trop_large",
    pieceId: "juste",
  });
  cas.push({
    nom: "contour en huit (se croise) : refusé avant calcul",
    entree: {
      version: "seritex.imbrication/v1",
      tissu: tissu(600),
      calcul,
      pieces: [{ id: "huit", contour: [[0, 0], [200, 100], [200, 0], [0, 60]], quantite: 1, rotations: [0] }],
    },
    code: "contour_invalide",
    pieceId: "huit",
  });
  cas.push({
    nom: "marges de lisière plus larges que le tissu",
    entree: { version: "seritex.imbrication/v1", tissu: tissu(300, 150), calcul, pieces: [{ id: "a", contour: forme("L", 50, 50, g), quantite: 1, rotations: [0] }] },
    code: "marge_invalide",
  });
  cas.push({
    nom: "quantité nulle refusée par le contrat",
    entree: { version: "seritex.imbrication/v1", tissu: tissu(300), calcul, pieces: [{ id: "a", contour: forme("L", 50, 50, g), quantite: 0, rotations: [0] }] },
    code: "entree_invalide",
  });
  return cas;
}

/**
 * Cas limites qui DOIVENT réussir : la pièce ne tient que dans une partie
 * de ses rotations autorisées, ou remplit exactement la largeur.
 */
function casLimites(): { nom: string; entree: EntreeImbrication; verifier?: (r: Extract<ResultatMoteur, { ok: true }>) => string | null }[] {
  const calcul = { temps_max_s: TEMPS_MAX_S, graine: 11, effort: EFFORT };
  const haute: P[] = [[0, 0], [80, 0], [80, 50], [40, 50], [40, 380], [0, 380]]; // L, 380 mm de haut à 0°
  return [
    {
      nom: "L trop haut à 0° mais qui tient à 90° (rotations {0, 90})",
      entree: {
        version: "seritex.imbrication/v1",
        tissu: { largeur_utile: 300, marge_lisiere: 0 },
        calcul,
        pieces: [{ id: "L", contour: haute, quantite: 3, rotations: [0, 90] }],
      },
      verifier: (r) => (r.sortie.placements.every((p) => Math.abs(angle360(p.rotation) - 90) < 1e-3) ? null : "une pièce posée à 0° alors qu'elle ne tient pas"),
    },
    // Largeur EXACTEMENT remplie (hauteur + 2 × espacement = largeur − 2 × marge) :
    // le moteur accepte la pièce à l'entrée (rust/imbrication/src/lib.rs,
    // contrôle « piece_trop_large » à EPS près) ; il doit donc la poser.
    // Constaté le 2026-11-14 : échec « moteur » (« could not construct an
    // initial placement for item 0 »), alors qu'à 0,01 mm de moins le tracé
    // est valide. Défaut signalé, non corrigé ici (voir rapport I-04).
    {
      nom: "pièce de 500 mm sur une laize de 500 mm (sans marge ni espacement)",
      entree: {
        version: "seritex.imbrication/v1",
        tissu: { largeur_utile: 500, marge_lisiere: 0 },
        calcul,
        pieces: [{ id: "pleine", contour: [[0, 0], [100, 0], [100, 500], [0, 500]], quantite: 2, rotations: [0] }],
      },
    },
    {
      nom: "pièce à 0,01 mm près de la largeur utilisable (marges et espacement)",
      entree: {
        version: "seritex.imbrication/v1",
        tissu: { largeur_utile: 500, marge_lisiere: 10 },
        espacement: 3,
        calcul,
        pieces: [{ id: "presque", contour: [[0, 0], [100, 0], [100, 473.99], [0, 473.99]], quantite: 2, rotations: [0, 180] }],
      },
    },
    {
      nom: "pièce qui remplit exactement la largeur utilisable (marges et espacement)",
      entree: {
        version: "seritex.imbrication/v1",
        tissu: { largeur_utile: 500, marge_lisiere: 10 },
        espacement: 3,
        calcul,
        pieces: [
          { id: "pleine", contour: [[0, 0], [100, 0], [100, 474], [0, 474]], quantite: 2, rotations: [0, 180] },
          { id: "pleine-d", contour: [[0, 0], [60, 0], [100, 474], [0, 474]], quantite: 2, rotations: [180], miroir: true },
        ],
      },
    },
    {
      nom: "une seule pièce, une seule rotation {180}, retournée",
      entree: {
        version: "seritex.imbrication/v1",
        tissu: { largeur_utile: 400, marge_lisiere: 5 },
        calcul,
        pieces: [{ id: "seule", contour: [[1000, 1000], [1150, 1000], [1150, 1060], [1050, 1060], [1050, 1200], [1000, 1200]], quantite: 1, rotations: [180], miroir: true }],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Mutations : tracés faux fabriqués à partir de vrais tracés.
// Les deux avis doivent les refuser, pour la même raison.
// ---------------------------------------------------------------------------

export function mutations(r: Extract<ResultatMoteur, { ok: true }>, g: Prng): { nom: string; sortie: SortieImbrication; attendu: string }[] {
  const pls = r.sortie.placements;
  const avec = (f: (p: typeof pls) => typeof pls) => sortieSchema.parse({ ...r.sortie, placements: f(pls.map((p) => ({ ...p }))) });
  const i = g.entier(0, pls.length - 1);
  const L = r.entree.tissu.largeur_utile;
  const res: { nom: string; sortie: SortieImbrication; attendu: string }[] = [
    { nom: "pièce retirée", sortie: avec((p) => p.filter((_, k) => k !== i)), attendu: "quantite" },
    { nom: "pièce poussée au-delà de la laize", sortie: avec((p) => (p[i].y += L, p)), attendu: "hors_largeur" },
    { nom: "pièce placée avant X = 0", sortie: avec((p) => (p[i].x -= 100_000, p)), attendu: "hors_longueur" },
    { nom: "rotation de 90° non autorisée", sortie: avec((p) => ((p[i].rotation = angle360(p[i].rotation + 90)), p)), attendu: "rotation" },
    { nom: "retournement inversé", sortie: avec((p) => ((p[i].miroir = !p[i].miroir), p)), attendu: "miroir" },
  ];
  // Deux exemplaires de la même pièce posés au même endroit (superposition exacte).
  const memes = pls.map((p, k) => k).filter((k) => pls[k].piece_id === pls[i].piece_id && k !== i);
  if (memes.length > 0) {
    const j = memes[0];
    res.push({ nom: "deux exemplaires superposés exactement", sortie: avec((p) => ((p[j] = { ...p[i] }), p)), attendu: "chevauchement" });
  }
  // Une autre pièce posée sur celle-ci : un point intérieur de chacune amené au même endroit.
  const k = (i + 1) % pls.length;
  if (k !== i) {
    const parId = new Map(r.entree.pieces.map((p) => [p.id, p]));
    const posee = (pl: (typeof pls)[number]) => poser(contourOuvert(parId.get(pl.piece_id)!.contour as P[]), pl);
    const ti = pointsTemoins(posee(pls[i])).slice(posee(pls[i]).length);
    const tk = pointsTemoins(posee(pls[k])).slice(posee(pls[k]).length);
    if (ti.length > 0 && tk.length > 0) {
      res.push({
        nom: "pièce posée sur une autre (point intérieur commun)",
        sortie: avec((p) => ((p[k].x += ti[0][0] - tk[0][0]), (p[k].y += ti[0][1] - tk[0][1]), p)),
        attendu: "chevauchement",
      });
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Section de test
// ---------------------------------------------------------------------------

export async function sectionProprietes(verifier: Verifier) {
  console.log("H. Propriétés du moteur sur des jeux tirés au hasard (graine fixe)");
  const t0 = Date.now();
  verifier(
    "tolérances du test = tolérances de validation.ts (0,01 / 0,05 mm)",
    TOL_CHEVAUCHEMENT_MM === TOLERANCE_MM && TOL_ESPACEMENT_MM === TOLERANCE_ESPACEMENT_MM,
    [TOLERANCE_MM, TOLERANCE_ESPACEMENT_MM]
  );
  const g1 = prng(GRAINE_TIRAGE);
  const g2 = prng(GRAINE_TIRAGE);
  const jeux = Array.from({ length: NB_JEUX_ALEATOIRES }, (_, i) => tirerJeu(i, g1));
  verifier(
    "tirage reproductible (même graine de tirage = mêmes jeux)",
    JSON.stringify(jeux) === JSON.stringify(Array.from({ length: NB_JEUX_ALEATOIRES }, (_, i) => tirerJeu(i, g2)))
  );
  const couverture = {
    concaves: jeux.filter((j) => j.concave).length,
    convexesSeules: jeux.filter((j) => !j.concave).length,
    paires: jeux.filter((j) => j.paire).length,
    r0: jeux.filter((j) => j.jeuxRotations.includes("{0}")).length,
    r180: jeux.filter((j) => j.jeuxRotations.includes("{180}")).length,
    r0180: jeux.filter((j) => j.jeuxRotations.includes("{0,180}")).length,
    laizes: new Set(jeux.map((j) => j.entree.tissu.largeur_utile)).size,
    pieces: jeux.reduce((s, j) => s + j.entree.pieces.reduce((t, p) => t + p.quantite, 0), 0),
  };
  console.log(`    couverture : ${JSON.stringify(couverture)}`);
  verifier(
    `couverture du tirage (${NB_JEUX_ALEATOIRES} jeux : concaves, convexes, paires, {0}, {180}, {0,180}, plusieurs laizes)`,
    NB_JEUX_ALEATOIRES >= 50 &&
      couverture.concaves >= 10 &&
      couverture.convexesSeules >= 5 &&
      couverture.paires >= 5 &&
      couverture.r0 >= 5 &&
      couverture.r180 >= 5 &&
      couverture.r0180 >= 5 &&
      couverture.laizes >= 4,
    couverture
  );
  verifier("contours tirés acceptés par controlerContours (simples, avec surface)", jeux.every((j) => entreeSchema.safeParse(j.entree).success && controlerContours(j.entree.pieces).length === 0));

  // Chaque jeu calculé deux fois (déterminisme) ; les deux exécutions tournent
  // dans des threads différents, au milieu d'autres calculs.
  const limites = casLimites();
  const aCalculer = [...jeux.map((j) => ({ nom: j.nom, entree: j.entree })), ...limites];
  const premiers = await enParallele(aCalculer, PARALLELISME, (c) => imbriquer(c.entree));
  const seconds = await enParallele(aCalculer, PARALLELISME, (c) => imbriquer(c.entree));

  const bilan: Bilan = { traces: 0, echecs: {} };
  const divergences: string[] = [];
  aCalculer.forEach((c, i) => {
    controlerTrace(c.nom, premiers[i], bilan);
    controlerTrace(`${c.nom} (2e exécution)`, seconds[i], bilan);
    if (signature(premiers[i]) !== signature(seconds[i])) divergences.push(c.nom);
  });
  for (const [prop, liste] of Object.entries(bilan.echecs)) {
    verifier(`${prop} (${aCalculer.length * 2 - liste.length}/${aCalculer.length * 2} tracés)`, liste.length === 0, liste.slice(0, 6));
  }
  verifier(
    `déterminisme : même entrée + même graine + même effort = même tracé, placements et longueur exacts (${aCalculer.length - divergences.length}/${aCalculer.length})`,
    divergences.length === 0,
    divergences
  );
  limites.forEach((c, k) => {
    const r = premiers[jeux.length + k];
    const pb = r.ok && c.verifier ? c.verifier(r) : null;
    verifier(`cas limite : ${c.nom}`, r.ok && r.validation.valide && pb === null, r.ok ? (pb ?? r.validation.problemes) : r);
  });

  // Autre graine → autre tracé (au moins sur une partie des jeux : un jeu
  // très simple peut légitimement donner le même tracé).
  const echantillon = jeux.filter((j) => j.entree.pieces.reduce((s, p) => s + p.quantite, 0) >= 6).slice(0, 8);
  const autres = await enParallele(echantillon, PARALLELISME, (j) =>
    imbriquer({ ...j.entree, calcul: { ...j.entree.calcul, graine: j.entree.calcul.graine + 1 } })
  );
  const differents = autres.filter((r, k) => signature(r) !== signature(premiers[jeux.indexOf(echantillon[k])])).length;
  verifier(`autre graine = autre tracé (${differents}/${echantillon.length} jeux de 6 pièces et plus)`, differents >= Math.ceil(echantillon.length / 2), differents);

  // Cas impossibles : le code d'erreur prévu, deux fois le même.
  const gi = prng(GRAINE_TIRAGE + 1);
  const impossibles = casImpossibles(gi);
  const ri = await enParallele(impossibles, PARALLELISME, (c) => imbriquer(c.entree));
  const ri2 = await enParallele(impossibles, PARALLELISME, (c) => imbriquer(c.entree));
  impossibles.forEach((c, k) => {
    const r = ri[k];
    verifier(
      `cas impossible : ${c.nom} → ${c.code}`,
      !r.ok && r.code === c.code && (c.pieceId === undefined || r.pieceId === c.pieceId) && signature(r) === signature(ri2[k]),
      r.ok ? `tracé rendu (${r.sortie.placements.length} pièces)` : [r.code, r.pieceId]
    );
  });

  // Mutations des vrais tracés : les deux avis refusent, pour la même raison.
  const gm = prng(GRAINE_TIRAGE + 2);
  let nbMutations = 0;
  const desaccords: string[] = [];
  const nonVus: string[] = [];
  const nonVusSuperposition: string[] = [];
  jeux.forEach((j, k) => {
    const r = premiers[k];
    if (!r.ok || r.sortie.placements.length < 2) return;
    for (const m of mutations(r, gm)) {
      nbMutations++;
      const v = validerTrace(r.entree, m.sortie);
      const a = secondAvis(r.entree, m.sortie);
      const cv = new Set<string>(v.problemes.map((p) => p.code));
      if (!cv.has(m.attendu) || !a.codes.has(m.attendu as CodeSecondAvis)) {
        const ligne = `${j.nom} / ${m.nom} : validerTrace=[${[...cv]}] second=[${[...a.codes]}] (${a.details.join(" | ")})`;
        (m.attendu === "chevauchement" ? nonVusSuperposition : nonVus).push(ligne);
      } else if (!egaliteCodes(cv, a.codes)) {
        desaccords.push(`${j.nom} / ${m.nom} : validerTrace=[${[...cv]}] second=[${[...a.codes]}] (${a.details.join(" | ")})`);
      }
    }
  });
  verifier(`tracés faussés (${nbMutations} mutations) : pièce manquante, hors laize, avant X = 0, rotation, miroir vus par les deux avis`, nonVus.length === 0, nonVus.slice(0, 8));
  // Superposition (bords confondus, sommets posés sur les bords de l'autre) :
  // validerTrace ne teste que les croisements francs et les SOMMETS
  // intérieurs ; constaté le 2026-11-14 qu'il laisse passer ces cas
  // (validation.ts, relation / contientUnSommet). Défaut signalé (rapport I-04).
  verifier(
    `tracés faussés : pièces superposées (bords confondus) vues par les deux avis (${nonVusSuperposition.length} non vues)`,
    nonVusSuperposition.length === 0,
    nonVusSuperposition.slice(0, 8)
  );
  verifier(`tracés faussés : les deux avis signalent les mêmes problèmes`, desaccords.length === 0, desaccords.slice(0, 8));

  console.log(
    `    ${jeux.length} jeux aléatoires + ${limites.length} cas limites calculés 2 fois (${bilan.traces} tracés vérifiés), ` +
      `${impossibles.length} cas impossibles, ${nbMutations} mutations, ${((Date.now() - t0) / 1000).toFixed(1)} s`
  );
}
