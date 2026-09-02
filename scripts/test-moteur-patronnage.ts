/**
 * Banc de test du moteur de reconnaissance — module Patronnage.
 *
 * Vérifie sur des DXF générés (contours réalistes de pièces T-shirt) que :
 *  1. un tracé à la bonne échelle est reconnu sans correction ;
 *  2. un tracé exporté en mauvaise unité (×0,1 / ×10 / ×100 / ×0,01) est
 *     corrigé automatiquement et reconnu ;
 *  3. une pièce posée en miroir est reconnue ET marquée comme telle ;
 *  4. une pièce d'une AUTRE TAILLE reste non reconnue — la tolérance
 *     d'échelle fichier ne doit jamais absorber une erreur de gradation.
 *
 * Lancer : npx tsx scripts/test-moteur-patronnage.ts
 */
import { parseDxfContours } from "../src/lib/patronnage/dxf";
import { normalizeShape, type Point } from "../src/lib/patronnage/geometry";
import { reconnaitreTrace, type ReferencePiece } from "../src/lib/patronnage/reconnaissance";

/* ---------- Génération de contours de pièces plausibles ---------- */

function devantTshirt(scale = 1): Point[] {
  // Silhouette simplifiée mais asymétrique (encolure décalée) : l'asymétrie
  // est indispensable pour que le test miroir soit discriminant.
  const pts: Point[] = [
    [0, 0], [520, 0], [520, 420], [660, 480], [640, 560],
    [470, 530], [470, 720], [300, 760], [180, 720], [120, 620],
    [40, 560], [0, 470],
  ];
  return pts.map(([x, y]) => [x * scale, y * scale] as Point);
}

function manche(scale = 1): Point[] {
  const pts: Point[] = [
    [0, 0], [340, 0], [360, 180], [300, 240], [120, 250], [20, 160],
  ];
  return pts.map(([x, y]) => [x * scale, y * scale] as Point);
}

function translate(pts: Point[], dx: number, dy: number): Point[] {
  return pts.map(([x, y]) => [x + dx, y + dy] as Point);
}

function rotate(pts: Point[], deg: number): Point[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return pts.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos] as Point);
}

function mirror(pts: Point[]): Point[] {
  return pts.map(([x, y]) => [-x, y] as Point).reverse();
}

/* ---------- Écriture d'un DXF minimal mais valide ---------- */

function toDxf(pieces: { layer: string; points: Point[] }[]): string {
  const head = ["0", "SECTION", "2", "ENTITIES"];
  const body: string[] = [];
  for (const { layer, points } of pieces) {
    body.push("0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", "1");
    for (const [x, y] of points) body.push("10", x.toFixed(4), "20", y.toFixed(4));
  }
  return [...head, ...body, "0", "ENDSEC", "0", "EOF"].join("\n");
}

/* ---------- Bibliothèque de référence ---------- */

function makeRef(id: string, article: string, taille: string, piece: string, points: Point[]): ReferencePiece {
  const g = normalizeShape(points);
  return { id, article, taille, piece, geom: g };
}

const biblio: ReferencePiece[] = [
  makeRef("dev-M", "TS-COL-ROND", "M", "Devant", devantTshirt(1)),
  makeRef("man-M", "TS-COL-ROND", "M", "Manche", manche(1)),
  // Taille L : +6 % linéaire, l'écart de gradation typique
  makeRef("dev-L", "TS-COL-ROND", "L", "Devant", devantTshirt(1.06)),
  makeRef("man-L", "TS-COL-ROND", "L", "Manche", manche(1.06)),
];

/* ---------- Cas de test ---------- */

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function analyser(pieces: { layer: string; points: Point[] }[]) {
  const contours = parseDxfContours(toDxf(pieces));
  return { contours, res: reconnaitreTrace(contours, biblio) };
}

// --- 1. Tracé correct, pièces tournées et translatées (cas nominal Diamino)
console.log("\n1. Tracé à la bonne échelle, pièces tournées");
{
  const pieces = [
    { layer: "CONTOUR", points: translate(devantTshirt(), 0, 0) },
    { layer: "CONTOUR", points: translate(rotate(devantTshirt(), 180), 1400, 800) },
    { layer: "CONTOUR", points: translate(rotate(manche(), 90), 1500, 0) },
    { layer: "CONTOUR", points: translate(manche(), 700, 900) },
    { layer: "REPERES", points: [[0, 0], [10, 0], [10, 10]] as Point[] },
  ];
  const { contours, res } = analyser(pieces);
  check("calque REPERES exclu", contours.length === 4, `${contours.length} contours`);
  check("facteur d'échelle = 1", res.facteurEchelle === 1, `f=${res.facteurEchelle}`);
  check("100 % reconnu", res.reconnaissanceComplete, `taux=${(res.tauxReconnaissance * 100).toFixed(0)}%`);
  check("aucune alerte miroir", !res.alerteMiroir);
}

// --- 2. Mauvaise unité à l'export
for (const f of [0.01, 0.1, 10, 100]) {
  console.log(`\n2. Tracé exporté avec un facteur ${f} (mauvaise unité)`);
  const pieces = [
    { layer: "CONTOUR", points: devantTshirt(f) },
    { layer: "CONTOUR", points: translate(rotate(devantTshirt(f), 45), 900 * f, 0) },
    { layer: "CONTOUR", points: manche(f) },
    { layer: "CONTOUR", points: translate(manche(f), 500 * f, 500 * f) },
  ];
  const { res } = analyser(pieces);
  const attendu = 1 / f;
  check(`facteur correctif détecté = ${attendu}`, res.facteurEchelle === attendu, `f=${res.facteurEchelle}`);
  check("100 % reconnu après correction", res.reconnaissanceComplete, `taux=${(res.tauxReconnaissance * 100).toFixed(0)}%`);
  check("alerte échelle levée", res.alerteEchelle);
}

// --- 3. Pièces posées en miroir
console.log("\n3. Manches posées en miroir (symétrie gauche/droite)");
{
  const pieces = [
    { layer: "CONTOUR", points: devantTshirt() },
    { layer: "CONTOUR", points: manche() },
    { layer: "CONTOUR", points: translate(mirror(manche()), 900, 0) },
    { layer: "CONTOUR", points: translate(rotate(mirror(manche()), 30), 1600, 400) },
  ];
  const { res } = analyser(pieces);
  check("100 % reconnu", res.reconnaissanceComplete, `taux=${(res.tauxReconnaissance * 100).toFixed(0)}%`);
  check("alerte miroir levée", res.alerteMiroir);
  const man = res.patronsReconnus.find((p) => p.piece === "Manche");
  check("2 manches comptées en miroir", man?.dont_en_miroir === 2, `dont_en_miroir=${man?.dont_en_miroir}`);
  check("aucune correction d'échelle parasite", res.facteurEchelle === 1, `f=${res.facteurEchelle}`);
}

// --- 4. ÉTANCHÉITÉ : erreur de taille, ne doit PAS être absorbée
console.log("\n4. Erreur de taille (pièce XL ~+12 % posée sur un tracé M)");
{
  const inconnu = devantTshirt(1.12); // ni M (1.00) ni L (1.06)
  const pieces = [
    { layer: "CONTOUR", points: devantTshirt() },
    { layer: "CONTOUR", points: manche() },
    { layer: "CONTOUR", points: translate(inconnu, 1200, 0) },
  ];
  const { res } = analyser(pieces);
  check("pièce hors gradation NON reconnue", res.piecesNonReconnues.length === 1, `${res.piecesNonReconnues.length} non reconnue(s)`);
  check("verdict incomplet", !res.reconnaissanceComplete);
  check("pas de correction d'échelle abusive", res.facteurEchelle === 1, `f=${res.facteurEchelle}`);
  const np = res.piecesNonReconnues[0];
  check("meilleure piste remontée", np?.meilleur_candidat !== null, `${np?.meilleur_candidat?.taille} @ ${np?.meilleur_score}`);
}

// --- 5. Mauvaise taille ET mauvaise unité simultanément
console.log("\n5. Tracé en mauvaise unité contenant une pièce de mauvaise taille");
{
  const f = 0.1;
  const pieces = [
    { layer: "CONTOUR", points: devantTshirt(f) },
    { layer: "CONTOUR", points: manche(f) },
    { layer: "CONTOUR", points: translate(manche(f), 500 * f, 0) },
    { layer: "CONTOUR", points: translate(devantTshirt(1.12 * f), 900 * f, 0) },
  ];
  const { res } = analyser(pieces);
  check("échelle corrigée (×10)", res.facteurEchelle === 10, `f=${res.facteurEchelle}`);
  check("erreur de taille toujours détectée", res.piecesNonReconnues.length === 1, `${res.piecesNonReconnues.length} non reconnue(s)`);
  check("verdict incomplet", !res.reconnaissanceComplete);
}

// --- 6. Bibliothèque sans correspondance : aucune correction inventée
console.log("\n6. Tracé sans aucune correspondance dans la bibliothèque");
{
  const etranger: Point[] = [[0, 0], [1000, 0], [1000, 30], [0, 30]];
  const { res } = analyser([{ layer: "CONTOUR", points: etranger }]);
  check("aucun facteur d'échelle inventé", res.facteurEchelle === 1, `f=${res.facteurEchelle}`);
  check("pièce non reconnue", res.piecesNonReconnues.length === 1);
}

console.log(
  failures === 0 ? "\n✅ Tous les cas passent.\n" : `\n❌ ${failures} assertion(s) en échec.\n`
);
process.exit(failures === 0 ? 0 : 1);
