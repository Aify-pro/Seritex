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
 *  7. une pièce exportée en plusieurs contours imbriqués (ligne de coupe +
 *     valeur de couture + détail interne, convention constatée sur des
 *     tracés réels) ne compte que pour UNE pièce, sur son contour externe ;
 *  8. une pièce posée via une entité INSERT référençant un bloc (dxf.blocks)
 *     est reconnue au même titre qu'une entité LWPOLYLINE directe.
 *  9. une ligne de coupe exportée en DEUX polylignes ouvertes (bout à bout),
 *     à côté d'une ligne de couture fermée (convention du patron T-shirt
 *     réel) : la coupe est reconstruite en contour fermé et sert seule à la
 *     reconnaissance ; la couture est conservée pour l'affichage.
 * 10. les pièces non reconnues de même forme (miroir compris) sont regroupées
 *     en familles — l'unité d'affectation de l'apprentissage via le tracé ;
 * 11. une pièce d'une AUTRE TAILLE (≥ 90 % de ressemblance, < 98 %) reste non
 *     reconnue mais est signalée « taille différente », jamais absorbée ;
 * 12. même avec un écart d'échelle décimal (×10), une taille L n'est jamais
 *     reconnue comme M : aucune correction d'échelle inventée.
 *
 * Lancer : npx tsx scripts/test-moteur-patronnage.ts
 */
import { parseDxfContours } from "../src/lib/patronnage/dxf";
import { normalizeShape, type Point } from "../src/lib/patronnage/geometry";
import { reconnaitreTrace, type ReferencePiece } from "../src/lib/patronnage/reconnaissance";
import { construireAnalyseDetaillee } from "../src/lib/patronnage/detail";

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

// Contour imbriqué à l'intérieur d'une pièce (valeur de couture, détail
// interne) : un homothétique légèrement plus petit, centré sur le même
// repère que la pièce d'origine — reproduit la convention constatée sur des
// tracés réels (plusieurs contours quasi concentriques par pièce).
function contourInterieur(pts: Point[], facteur: number): Point[] {
  return pts.map(([x, y]) => [x * facteur, y * facteur] as Point);
}

// Petit détail interne (dart, cran) : un losange minuscule posé dans
// l'emprise de la pièce.
function detailInterne(cx: number, cy: number): Point[] {
  const r = 5;
  return [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
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

// DXF utilisant la convention BLOCK/INSERT (une pièce = un bloc nommé posé
// via une entité INSERT, position + rotation) au lieu de LWPOLYLINE au
// niveau racine — convention constatée sur un tracé de placement réel.
function toDxfWithBlocks(
  inserts: { block: string; layer: string; points: Point[]; x: number; y: number; rotationDeg: number }[]
): string {
  const blockNames = [...new Set(inserts.map((i) => i.block))];
  const blocksSection: string[] = ["0", "SECTION", "2", "BLOCKS"];
  for (const name of blockNames) {
    const def = inserts.find((i) => i.block === name)!;
    blocksSection.push("0", "BLOCK", "8", "0", "2", name, "70", "0", "10", "0.0", "20", "0.0");
    blocksSection.push(
      "0",
      "LWPOLYLINE",
      "8",
      def.layer,
      "90",
      String(def.points.length),
      "70",
      "1"
    );
    for (const [x, y] of def.points) blocksSection.push("10", x.toFixed(4), "20", y.toFixed(4));
    blocksSection.push("0", "ENDBLK");
  }
  blocksSection.push("0", "ENDSEC");

  const entitiesSection: string[] = ["0", "SECTION", "2", "ENTITIES"];
  for (const i of inserts) {
    entitiesSection.push(
      "0",
      "INSERT",
      "8",
      "0",
      "2",
      i.block,
      "10",
      i.x.toFixed(4),
      "20",
      i.y.toFixed(4),
      "50",
      String(i.rotationDeg)
    );
  }
  entitiesSection.push("0", "ENDSEC");

  return [...blocksSection, ...entitiesSection, "0", "EOF"].join("\n");
}

// Un bloc par pièce, chaque bloc contenant plusieurs polylignes (fermées ou
// non), posé sans transformation — structure du patron T-shirt réel.
function toDxfBlocsMulti(
  blocs: { name: string; polys: { layer: string; points: Point[]; ferme: boolean }[] }[]
): string {
  const out: string[] = ["0", "SECTION", "2", "BLOCKS"];
  for (const b of blocs) {
    out.push("0", "BLOCK", "8", "0", "2", b.name, "70", "0", "10", "0.0", "20", "0.0");
    for (const { layer, points, ferme } of b.polys) {
      out.push("0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", ferme ? "1" : "0");
      for (const [x, y] of points) out.push("10", x.toFixed(4), "20", y.toFixed(4));
    }
    out.push("0", "ENDBLK");
  }
  out.push("0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  for (const b of blocs) out.push("0", "INSERT", "8", "0", "2", b.name, "10", "0.0", "20", "0.0");
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
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

// --- 7. Contours imbriqués (ligne de coupe + valeur de couture + détail
// interne) : convention constatée sur des tracés réels — une seule pièce
// doit être comptée, sur son contour externe.
console.log("\n7. Pièce exportée en 3 contours imbriqués (coupe + couture + détail)");
{
  const dev = devantTshirt();
  const pieces = [
    { layer: "CONTOUR", points: dev }, // contour de coupe (externe)
    { layer: "CONTOUR", points: contourInterieur(dev, 0.95) }, // valeur de couture
    { layer: "CONTOUR", points: detailInterne(300, 300) }, // détail interne
    { layer: "CONTOUR", points: translate(manche(), 1500, 900) }, // pièce distincte, non imbriquée
  ];
  const { contours, res } = analyser(pieces);
  check("contours imbriqués dédupliqués (2 pièces, pas 4)", contours.length === 2, `${contours.length} contour(s)`);
  check("100 % reconnu sur le contour externe", res.reconnaissanceComplete, `taux=${(res.tauxReconnaissance * 100).toFixed(0)}%`);
  const devantReconnu = res.patronsReconnus.find((p) => p.piece === "Devant");
  check("Devant compté une seule fois", devantReconnu?.quantite === 1, `quantite=${devantReconnu?.quantite}`);
}

// --- 8. Pièces posées via bloc/INSERT (convention constatée sur un tracé de
// placement réel) au lieu de LWPOLYLINE au niveau racine.
console.log("\n8. Tracé utilisant des blocs (BLOCK/INSERT) au lieu de LWPOLYLINE racine");
{
  const dxfText = toDxfWithBlocks([
    { block: "PCE_001", layer: "1", points: devantTshirt(), x: 0, y: 0, rotationDeg: 0 },
    { block: "PCE_002", layer: "1", points: manche(), x: 1500, y: 400, rotationDeg: 90 },
  ]);
  const contours = parseDxfContours(dxfText);
  const res = reconnaitreTrace(contours, biblio);
  check("2 contours résolus depuis les blocs", contours.length === 2, `${contours.length} contour(s)`);
  check("100 % reconnu (position/rotation de l'INSERT appliquées)", res.reconnaissanceComplete, `taux=${(res.tauxReconnaissance * 100).toFixed(0)}%`);
}

// --- 9. Ligne de coupe en deux moitiés ouvertes + couture fermée (patron réel)
console.log("\n9. Coupe exportée en 2 polylignes ouvertes + ligne de couture fermée");
{
  const dev = devantTshirt();
  const man = translate(manche(), 1500, 0);
  const moities = (pts: Point[]) => {
    const k = Math.floor(pts.length / 2);
    // A = début→milieu, B = milieu→début : se rejoignent aux deux bouts, B inversé pour tester le sens
    return [pts.slice(0, k + 1), [...pts.slice(k), pts[0]].reverse()];
  };
  const bloc = (name: string, pts: Point[]) => {
    const [a, b] = moities(pts);
    return {
      name,
      polys: [
        { layer: "14", points: [...contourInterieur(pts, 0.95), contourInterieur(pts, 0.95)[0]], ferme: false }, // couture, fermée par doublon du 1er sommet
        { layer: "1", points: a, ferme: false },
        { layer: "1", points: b, ferme: false },
      ],
    };
  };
  const contours = parseDxfContours(toDxfBlocsMulti([bloc("PCE_001", dev), bloc("PCE_002", man)]));
  const res = reconnaitreTrace(contours, biblio);
  check("1 contour par pièce (2, pas 6)", contours.length === 2, `${contours.length} contour(s)`);
  check("contour retenu = ligne de coupe reconstruite (calque 1)", contours.every((c) => c.layer === "1"));
  check("100 % reconnu sur la coupe reconstruite", res.reconnaissanceComplete, `taux=${(res.tauxReconnaissance * 100).toFixed(0)}%`);
  check("ligne de couture conservée pour l'affichage", contours.every((c) => c.interieurs.length === 1), contours.map((c) => c.interieurs.length).join(","));
}

// --- 10. Familles de pièces non reconnues
console.log("\n10. Pièces non reconnues regroupées en familles (miroir compris)");
{
  const etrangerA: Point[] = [[0, 0], [400, 0], [400, 90], [180, 90], [180, 300], [0, 300]]; // L asymétrique
  const etrangerB: Point[] = [[0, 0], [300, 0], [300, 40], [150, 220], [0, 40]];
  const contours = parseDxfContours(
    toDxf([
      { layer: "1", points: translate(etrangerA, 0, 0) },
      { layer: "1", points: translate(rotate(etrangerA, 90), 900, 100) },
      { layer: "1", points: translate(mirror(etrangerA), 1800, 200) },
      { layer: "1", points: translate(etrangerB, 2700, 0) },
      { layer: "1", points: translate(devantTshirt(), 0, 1500) }, // reconnue, hors familles
    ])
  );
  const d = construireAnalyseDetaillee(contours, biblio);
  const fam = [...d.unrecognizedFamilies].sort((a, b) => b.count - a.count);
  check("2 familles (pas 4 pièces isolées)", fam.length === 2, `${fam.length} famille(s)`);
  check("famille A = 3 exemplaires dont 1 en miroir", fam[0]?.count === 3 && fam[0]?.mirroredCount === 1, `count=${fam[0]?.count} miroir=${fam[0]?.mirroredCount}`);
  check("famille B = 1 exemplaire", fam[1]?.count === 1);
  check("la pièce reconnue n'est dans aucune famille", d.recognized.length === 1 && fam.reduce((n, f) => n + f.count, 0) === 4);
}

// --- 11. Autre taille : ressemblance ≥ 90 % → « taille différente », jamais reconnue
console.log("\n11. Pièce d'une autre taille absente de la bibliothèque");
const biblioMseule = biblio.filter((r) => r.taille === "M");
{
  const contours = parseDxfContours(toDxf([{ layer: "1", points: devantTshirt(1.06) }])); // taille L
  const res = reconnaitreTrace(contours, biblioMseule);
  const d = construireAnalyseDetaillee(contours, biblioMseule);
  const score = res.piecesNonReconnues[0]?.meilleur_score ?? 0;
  check("le L n'est PAS reconnu comme M", res.piecesNonReconnues.length === 1 && res.patronsReconnus.length === 0, `score=${score}`);
  check("signalé « taille différente »", d.unrecognizedFamilies[0]?.nature === "taille_differente", `nature=${d.unrecognizedFamilies[0]?.nature} @ ${score}`);
}

// --- 12. Taille L à une échelle décimale : jamais confondue avec M
console.log("\n12. Taille L exportée ×10 (unité fausse) face à une bibliothèque M");
{
  const contours = parseDxfContours(toDxf([{ layer: "1", points: devantTshirt(10.6) }]));
  const res = reconnaitreTrace(contours, biblioMseule);
  check("aucun facteur d'échelle inventé pour rattraper la taille", res.facteurEchelle === 1, `f=${res.facteurEchelle}`);
  check("le L ×10 n'est PAS reconnu comme M", res.piecesNonReconnues.length === 1 && res.patronsReconnus.length === 0);
}

console.log(
  failures === 0 ? "\n✅ Tous les cas passent.\n" : `\n❌ ${failures} assertion(s) en échec.\n`
);
process.exit(failures === 0 ? 0 : 1);
