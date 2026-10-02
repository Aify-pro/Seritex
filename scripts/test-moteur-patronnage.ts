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
 * 13. ratio d'échelle imposé manuellement : un tracé que la détection auto
 *     laisse à ×1 (aucune correspondance exacte) devient exploitable ; une
 *     taille L reste « taille différente », jamais reconnue comme M ;
 * 14. détail pièce par pièce : dimensions en mm (1 unité = 0,1 mm), verdict et
 *     patron reconnu sur chaque ligne, dans l'ordre du tracé.
 * 15. DXF marqué (téléchargement) : texte au centre de chaque pièce reconnue
 *     (article/taille/pièce) ou « NON RECONNUE », cartouche avec QR — ajouté
 *     par SURCHARGE du fichier déposé (jamais une régénération à partir des
 *     contours analysés, cf. dxf-export.ts) ; échoue proprement si la section
 *     ENTITIES est introuvable, plutôt que de rendre un fichier à moitié marqué.
 *
 * Lancer : npx tsx scripts/test-moteur-patronnage.ts
 */
import DxfParser from "dxf-parser";
import { parseDxfContours } from "../src/lib/patronnage/dxf";
import { normalizeShape, type Point } from "../src/lib/patronnage/geometry";
import { construireAnalyseDetaillee } from "../src/lib/patronnage/detail";
import { genererDxfMarque } from "../src/lib/patronnage/dxf-export";
import { genererTracePdf } from "../src/lib/patronnage/trace-pdf";
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

// --- 13. Ratio manuel
console.log("\n13. Ratio d'échelle choisi manuellement");
{
  const contoursM10 = parseDxfContours(toDxf([{ layer: "1", points: devantTshirt(10) }]));
  const auto = reconnaitreTrace(contoursM10, biblioMseule);
  check("auto : M ×10 détecté (×0,1) et reconnu — référence", auto.facteurEchelle === 0.1 && auto.reconnaissanceComplete, `f=${auto.facteurEchelle}`);
  const manuel = reconnaitreTrace(contoursM10, biblioMseule, 98, { facteurForce: 0.1 });
  check("manuel ×0,1 : M ×10 reconnu", manuel.reconnaissanceComplete && manuel.facteurEchelle === 0.1, `f=${manuel.facteurEchelle}`);
  check("marqué comme échelle manuelle", manuel.echelleManuelle === true && auto.echelleManuelle === false);

  // Taille L exportée ×10 : la détection auto reste à ×1 (rien ne se confirme)
  const contoursL10 = parseDxfContours(toDxf([{ layer: "1", points: devantTshirt(10.6) }]));
  const autoL = reconnaitreTrace(contoursL10, biblioMseule);
  check("auto : L ×10 laissé à ×1 (garde-fou)", autoL.facteurEchelle === 1, `f=${autoL.facteurEchelle}`);
  const dL = construireAnalyseDetaillee(contoursL10, biblioMseule, 98, { facteurForce: 0.1 });
  check("manuel ×0,1 : L jamais reconnu comme M", dL.recognized.length === 0 && dL.unrecognizedFamilies.length === 1);
  check("manuel ×0,1 : signalé « taille différente »", dL.unrecognizedFamilies[0]?.nature === "taille_differente", `nature=${dL.unrecognizedFamilies[0]?.nature}`);
  check("manuel : facteur appliqué remonté dans le détail", dL.scaleFactor === 0.1);
}

// --- 14. Détail pièce par pièce, dimensions en mm mesurées sur les AXES DU
// TRACÉ (pose réelle), pas sur l'axe principal de la forme (`normalizeShape`) :
// une pièce posée droite (horizontale ou verticale, convention quasi
// systématique des tracés réels) doit donner la même dimension dans les deux
// cas ; seule une pose réellement en biais (rare) fait apparaître
// l'encombrement occupé plutôt que la taille intrinsèque — limite assumée et
// documentée, préférable à une mesure faussée par l'axe d'inertie sur le cas
// courant (c'était le défaut : une légère rotation détectée par le moteur
// gonflait les dimensions même sur une pièce posée bien droite).
console.log("\n14. Détail pièce par pièce (mm, mesurées sur la pose dans le tracé)");
{
  const rect: Point[] = [[0, 0], [1000, 0], [1000, 400], [0, 400]]; // 100 × 40 mm
  const contours = parseDxfContours(toDxf([
    { layer: "1", points: translate(rect, 500, 500) }, // posé droit (0°)
    { layer: "1", points: translate(rotate(rect, 90), 2500, 500) }, // posé droit (90°) : mêmes dimensions
    { layer: "1", points: translate(rotate(rect, 30), 4500, 500) }, // posé en biais (rare) : encombrement occupé
    { layer: "1", points: translate(devantTshirt(), 7000, 0) },
  ]));
  const d = construireAnalyseDetaillee(contours, biblioMseule);
  check("une ligne par pièce, dans l'ordre", d.lignes.length === 4 && d.lignes.every((l, i) => l.index === i));

  const [l0, l90, l30, lDevant] = d.lignes;
  check("posé à 0° : 100 × 40 mm", l0.largeurMm === 100 && l0.hauteurMm === 40, `${l0.largeurMm} × ${l0.hauteurMm}`);
  check("posé à 90° : mêmes dimensions (100 × 40)", l90.largeurMm === 100 && l90.hauteurMm === 40, `${l90.largeurMm} × ${l90.hauteurMm}`);
  check("périmètre et surface identiques quelle que soit la pose", l0.perimetreMm === 280 && l0.surfaceCm2 === 40 && l90.perimetreMm === 280 && l90.surfaceCm2 === 40);
  check(
    "posé en biais (30°) : encombrement occupé, pas la taille intrinsèque",
    l30.largeurMm === 107 && l30.hauteurMm === 85,
    `${l30.largeurMm} × ${l30.hauteurMm}`
  );
  check("mais périmètre/surface restent corrects (invariants par rotation)", l30.perimetreMm === 280 && l30.surfaceCm2 === 40);
  check("rectangle non reconnu, patron vide", !l0.reconnue && l0.patron === null);
  check("Devant reconnu, patron renseigné", lDevant.reconnue && lDevant.patron?.pieceName === "Devant", `${lDevant.patron?.pieceName} @ ${lDevant.score}`);
}

// --- 15. DXF marqué : marquage pièce par pièce + cartouche QR, par surcharge
console.log("\n15. DXF marqué (texte au centre des pièces + cartouche QR)");
{
  const cartouche = (facteurEchelle = 1): Parameters<typeof genererDxfMarque>[3] => ({
    traceReference: "OT-2026-0004-T1",
    numeroOt: "OT-2026-0004",
    odfReference: "OF-38906 — T-shirt col rond",
    clientLabel: "Client Test SARL",
    articleLabel: "T-shirt col rond 180g — Blanc",
    dateLabel: "01/10/2026",
    url: "https://seritex.example/atelier/patronnage/abc?trace=def",
    facteurEchelle,
  });

  // 100 % reconnu : Devant + Manche, tous deux dans la bibliothèque.
  const dxfText = toDxf([
    { layer: "1", points: devantTshirt() },
    { layer: "1", points: translate(manche(), 1500, 0) },
  ]);
  const contours = parseDxfContours(dxfText);
  const detailComplet = construireAnalyseDetaillee(contours, biblio);
  const resultat = genererDxfMarque(dxfText, contours, detailComplet.lignes, cartouche());
  check("marquage réussi (pas d'erreur)", "dxf" in resultat, "dxf" in resultat ? "" : (resultat as { error: string }).error);

  if ("dxf" in resultat) {
    // Le fichier marqué doit rester lisible par notre propre parseur — sinon
    // il ne le serait probablement pas non plus par un vrai lecteur CAO.
    const relu = new DxfParser().parseSync(resultat.dxf) as unknown as { entities: { type: string; text?: string; layer?: string }[] };
    const textes = relu.entities.filter((e) => e.type === "TEXT");
    check("relecture du fichier marqué sans erreur", Array.isArray(relu.entities));
    check(
      "une étiquette par pièce reconnue (Devant, Manche)",
      textes.some((t) => t.text?.includes("Devant")) && textes.some((t) => t.text?.includes("Manche")),
      textes.map((t) => t.text).join(" | ")
    );
    check("aucune pièce marquée « NON RECONNUE »", !textes.some((t) => t.text === "NON RECONNUE"));
    check(
      "verdict « toutes reconnues » dans le cartouche",
      textes.some((t) => t.layer === "SERITEX_CARTOUCHE" && t.text?.includes("TOUTES LES PIÈCES RECONNUES"))
    );
    check(
      "des entités QR (SOLID) sur le calque dédié",
      relu.entities.some((e) => e.type === "SOLID" && e.layer === "SERITEX_QR")
    );
  }

  // Orientation du cartouche (2026-10-02) : vertical = colonne étroite,
  // largeur fixe, QR en haut — jamais la largeur (quasi toujours très large)
  // du bandeau horizontal.
  const resultatV = genererDxfMarque(dxfText, contours, detailComplet.lignes, cartouche(), "vertical");
  check("marquage vertical réussi (pas d'erreur)", "dxf" in resultatV);
  if ("dxf" in resultatV) {
    const relu = new DxfParser().parseSync(resultatV.dxf) as unknown as {
      entities: { type: string; vertices?: { x: number; y: number }[]; layer?: string }[];
    };
    const cadre = relu.entities.find((e) => e.type === "POLYLINE" && e.layer === "SERITEX_CARTOUCHE");
    const xs = cadre?.vertices?.map((v) => v.x) ?? [];
    const largeurCadre = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    check("cartouche vertical nettement plus étroit que le cartouche horizontal", largeurCadre > 0 && largeurCadre < 1300, `largeur=${largeurCadre}`);
  }

  // Tracé partiellement reconnu : Devant reconnu, pièce étrangère non reconnue.
  const dxfPartiel = toDxf([
    { layer: "1", points: devantTshirt() },
    { layer: "1", points: translate([[0, 0], [400, 0], [400, 90], [180, 90], [180, 300], [0, 300]] as Point[], 1500, 0) },
  ]);
  const contoursPartiel = parseDxfContours(dxfPartiel);
  const detailPartiel = construireAnalyseDetaillee(contoursPartiel, biblio);
  const resultatPartiel = genererDxfMarque(dxfPartiel, contoursPartiel, detailPartiel.lignes, cartouche());
  if ("dxf" in resultatPartiel) {
    const relu = new DxfParser().parseSync(resultatPartiel.dxf) as unknown as {
      entities: { type: string; text?: string; layer?: string; colorIndex?: number }[];
    };
    const textes = relu.entities.filter((e) => e.type === "TEXT");
    check("pièce étrangère marquée « NON RECONNUE »", textes.some((t) => t.text === "NON RECONNUE"));
    const verdict = textes.find((t) => t.layer === "SERITEX_CARTOUCHE" && t.text?.includes("NON RECONNUE(S)"));
    check("verdict partiel présent, en rouge (ACI 1)", verdict?.colorIndex === 1, `colorIndex=${verdict?.colorIndex}`);
  } else {
    check("marquage partiel réussi (pas d'erreur)", false, resultatPartiel.error);
  }

  // Robustesse : un DXF sans section ENTITIES (ex. fichier tronqué) ne doit
  // jamais produire un fichier à moitié marqué — erreur explicite, c'est tout.
  const sansEntites = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n";
  const echec = genererDxfMarque(sansEntites, contours, detailComplet.lignes, cartouche());
  check("échoue proprement sans section ENTITIES (jamais un fichier à moitié marqué)", "error" in echec);
}

// --- 16. PDF du tracé : une page, proportionné, jamais à l'échelle 1:1
// (décision du 2026-10-02 — document de consultation, jamais un support de
// coupe, qui le dit explicitement). Sans marquage : contours seuls. Marqué :
// + étiquettes par pièce (rétrécies pour tenir, jamais de chevauchement) et
// cartouche QR, en horizontal ou vertical.
async function testerPdf() {
  console.log("\n16. PDF du tracé (sans marquage / marqué H / marqué V)");

  const dxfText = toDxf([
    { layer: "1", points: devantTshirt() },
    { layer: "1", points: translate(manche(), 1500, 0) },
  ]);
  const contours = parseDxfContours(dxfText);
  const detail = construireAnalyseDetaillee(contours, biblio);
  const info = {
    traceReference: "OT-2026-0004-T1",
    numeroOt: "OT-2026-0004",
    odfReference: "OF-38906 — T-shirt col rond",
    clientLabel: "Client Test SARL",
    articleLabel: "T-shirt col rond 180g — Blanc",
    dateLabel: "02/10/2026",
    url: "https://seritex.example/atelier/patronnage/abc?trace=def",
    facteurEchelle: detail.scaleFactor,
  };

  const sansMarquage = await genererTracePdf(contours, null);
  check("sans marquage : généré sans erreur", "pdf" in sansMarquage, "pdf" in sansMarquage ? "" : sansMarquage.error);
  if ("pdf" in sansMarquage) {
    check("sans marquage : commence bien par l'en-tête PDF", Buffer.from(sansMarquage.pdf.slice(0, 5)).toString() === "%PDF-");
  }

  const marqueH = await genererTracePdf(contours, { lignes: detail.lignes, info, orientation: "horizontal" });
  check("marqué horizontal : généré sans erreur", "pdf" in marqueH, "pdf" in marqueH ? "" : marqueH.error);

  const marqueV = await genererTracePdf(contours, { lignes: detail.lignes, info, orientation: "vertical" });
  check("marqué vertical : généré sans erreur", "pdf" in marqueV, "pdf" in marqueV ? "" : marqueV.error);

  if ("pdf" in marqueH && "pdf" in marqueV) {
    check("H et V produisent des fichiers différents (l'orientation change bien la mise en page)", Buffer.compare(marqueH.pdf, marqueV.pdf) !== 0);
  }

  // Tracé vide : jamais une exception, une erreur propre.
  const vide = await genererTracePdf([], null);
  check("tracé vide : échoue proprement (pas d'exception)", "error" in vide);
}

testerPdf().then(() => {
  console.log(
    failures === 0 ? "\n✅ Tous les cas passent.\n" : `\n❌ ${failures} assertion(s) en échec.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
});
