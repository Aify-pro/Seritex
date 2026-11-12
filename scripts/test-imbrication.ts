/**
 * Tests du moteur d'imbrication (Phase 1).
 *
 *  A. Contrat : l'entrée est validée strictement (champ inconnu, mauvaise version).
 *  B. Contours : un contour qui se croise est refusé avec le nom de la pièce.
 *  C. Validation indépendante, sur des tracés construits à la main :
 *     tracé correct, contact sans espacement, chevauchement, pièce incluse
 *     dans une autre, espacement insuffisant, rotation interdite, pièce hors
 *     de la largeur, pièce manquante, retournement non respecté, convention
 *     de transformation (miroir puis rotation puis translation).
 *  D. Moteur réel (WebAssembly, comme en production) :
 *     tracé complet et valide, reproductibilité (même entrée + même graine +
 *     même effort = même tracé), pièce plus large que le tissu, contour
 *     invalide, annulation en cours de calcul.
 *
 * Lancer : npm run test:imbrication
 */
import { entreeSchema, sortieSchema, type EntreeImbrication, type SortieImbrication } from "../src/lib/imbrication/contrat";
import { lancerImbrication, imbriquer } from "../src/lib/imbrication/moteur";
import { controlerContours, transformerContour, validerTrace, type Point } from "../src/lib/imbrication/validation";
import { entreeTshirt } from "./imbrication-fixtures";

let echecs = 0;
let total = 0;
function verifier(nom: string, condition: boolean, detail?: unknown) {
  total++;
  if (condition) console.log(`  ✓ ${nom}`);
  else {
    echecs++;
    console.log(`  ✗ ${nom}`, detail ?? "");
  }
}

const carre = (c: number): Point[] => [[0, 0], [c, 0], [c, c], [0, c]];

function entreeCarres(espacement = 0): ReturnType<typeof entreeSchema.parse> {
  return entreeSchema.parse({
    version: "seritex.imbrication/v1",
    tissu: { largeur_utile: 300, marge_lisiere: 0 },
    espacement,
    calcul: { temps_max_s: 10, graine: 1 },
    pieces: [
      { id: "a", contour: carre(100), quantite: 1, rotations: [0, 180] },
      { id: "b", contour: carre(100), quantite: 1, rotations: [0, 180] },
    ],
  });
}

function sortie(placements: SortieImbrication["placements"]): SortieImbrication {
  return sortieSchema.parse({
    version: "seritex.imbrication/v1",
    statut: "termine",
    arret: "budget_effort",
    longueur: 0,
    largeur_utile: 300,
    taux_utilisation: 0,
    depasse_longueur_max: false,
    temps_calcul_s: 0,
    effort_utilise: 0,
    reproductible: true,
    graine: 1,
    moteur: { nom: "sparrow", version: "0.3.0", jagua_rs: "1.0.0", wrapper: "test" },
    placements,
  });
}

const pl = (piece_id: string, x: number, y: number, rotation = 0, miroir = false) => ({ piece_id, x, y, rotation, miroir });
const codes = (r: ReturnType<typeof validerTrace>) => r.problemes.map((p) => p.code);

async function main() {
  console.log("A. Contrat");
  const base = entreeTshirt({ tailles: ["M"], paquets: 1, tempsMaxS: 10 });
  verifier("entrée valide acceptée", entreeSchema.safeParse(base).success);
  verifier("champ inconnu refusé", !entreeSchema.safeParse({ ...base, inconnu: 1 }).success);
  verifier("mauvaise version refusée", !entreeSchema.safeParse({ ...base, version: "seritex.imbrication/v0" }).success);
  verifier("valeurs par défaut (marge, effort)", entreeSchema.parse({ ...base, tissu: { largeur_utile: 1000 } }).tissu.marge_lisiere === 0);

  console.log("B. Contours");
  // Contour en huit asymétrique (surface non nulle, bords qui se croisent).
  const huit: Point[] = [[0, 0], [200, 100], [200, 0], [0, 60]];
  const pb = controlerContours([{ id: "dos-M", contour: huit }, { id: "ok", contour: carre(10) }]);
  verifier("contour en huit refusé", pb.length === 1 && pb[0].pieceId === "dos-M" && pb[0].message.includes("se croise"), pb);
  verifier("contours du t-shirt acceptés", controlerContours(base.pieces).length === 0, controlerContours(base.pieces));

  console.log("C. Validation indépendante");
  const e0 = entreeCarres();
  verifier("tracé correct", validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 150, 0)])).valide);
  verifier("contact bord à bord sans espacement = valide", validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 100, 0)])).valide);
  verifier("bruit flottant de 0,001 mm toléré", validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 99.999, 0)])).valide);
  verifier("chevauchement détecté", codes(validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 60, 30)]))).includes("chevauchement"));
  const eInclus = entreeSchema.parse({
    ...e0,
    pieces: [
      { id: "a", contour: carre(100), quantite: 1, rotations: [0] },
      { id: "b", contour: carre(20), quantite: 1, rotations: [0] },
    ],
  });
  verifier("pièce entièrement incluse détectée", codes(validerTrace(eInclus, sortie([pl("a", 0, 0), pl("b", 40, 40)]))).includes("chevauchement"));
  const e5 = entreeCarres(5);
  verifier("espacement insuffisant détecté", codes(validerTrace(e5, sortie([pl("a", 0, 0), pl("b", 102, 0)]))).includes("espacement"));
  verifier("espacement respecté", validerTrace(e5, sortie([pl("a", 0, 0), pl("b", 105, 0)])).valide);
  verifier("rotation interdite détectée", codes(validerTrace(e0, sortie([pl("a", 100, 0, 90), pl("b", 150, 0)]))).includes("rotation"));
  verifier("rotation 180° acceptée", validerTrace(e0, sortie([pl("a", 100, 100, 180), pl("b", 150, 0)])).valide);
  verifier("hors largeur détecté", codes(validerTrace(e0, sortie([pl("a", 0, 250), pl("b", 150, 0)]))).includes("hors_largeur"));
  verifier("pièce manquante détectée", codes(validerTrace(e0, sortie([pl("a", 0, 0)]))).includes("quantite"));
  verifier("retournement non demandé détecté", codes(validerTrace(e0, sortie([pl("a", 0, 100, 0, true), pl("b", 150, 0)]))).includes("miroir"));
  const t = transformerContour([[10, 20]], { x: 5, y: 7, rotation: 90, miroir: true });
  // (10, 20) → miroir (10, -20) → rotation 90° (20, 10) → translation (25, 17)
  verifier("convention miroir → rotation → translation", Math.abs(t[0][0] - 25) < 1e-9 && Math.abs(t[0][1] - 17) < 1e-9, t);
  const m = validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 150, 0)]));
  verifier("longueur et taux recalculés", m.longueurMm === 250 && Math.abs(m.tauxUtilisation - 20000 / (250 * 300)) < 1e-12, m);

  console.log("D. Moteur réel (WebAssembly)");
  const entree = entreeTshirt({ tailles: ["S", "M", "L"], paquets: 1, tempsMaxS: 120, effort: 150, graine: 7 });
  const t0 = Date.now();
  const r1 = await imbriquer(entree);
  const duree = (Date.now() - t0) / 1000;
  if (!r1.ok) {
    verifier("tracé calculé", false, r1);
  } else {
    const nb = entree.pieces.reduce((s, p) => s + p.quantite, 0);
    verifier(`tracé calculé (${r1.sortie.placements.length}/${nb} pièces, ${duree.toFixed(1)} s)`, r1.sortie.placements.length === nb);
    verifier("tracé validé par Seritex", r1.validation.valide, r1.validation.problemes);
    verifier("arrêt sur budget d'effort, déclaré reproductible", r1.sortie.arret === "budget_effort" && r1.sortie.reproductible, r1.sortie.arret);
    verifier("manches droites posées retournées", r1.sortie.placements.filter((p) => p.piece_id.startsWith("manche-d")).every((p) => p.miroir));
    verifier(
      "longueur du moteur = longueur recalculée (±0,5 mm)",
      Math.abs(r1.sortie.longueur - r1.validation.longueurMm) < 0.5,
      [r1.sortie.longueur, r1.validation.longueurMm]
    );
    console.log(
      `    longueur ${(r1.validation.longueurMm / 10).toFixed(1)} cm, utilisation ${(r1.validation.tauxUtilisation * 100).toFixed(2)} %, espacement min ${r1.validation.espacementMinMm?.toFixed(2)} mm`
    );
    const r2 = await imbriquer(entree);
    verifier("même entrée + même graine = même tracé", r2.ok && JSON.stringify(r2.sortie.placements) === JSON.stringify(r1.sortie.placements));
    const r3 = await imbriquer({ ...entree, calcul: { ...entree.calcul, graine: 8 } });
    verifier("autre graine = autre tracé", r3.ok && JSON.stringify(r3.sortie.placements) !== JSON.stringify(r1.sortie.placements));
  }

  const large: EntreeImbrication = {
    ...entree,
    tissu: { largeur_utile: 400, marge_lisiere: 5 },
  };
  const r4 = await imbriquer(large);
  verifier(
    "pièce plus large que le tissu : message clair",
    !r4.ok && r4.code === "piece_trop_large" && !!r4.pieceId && r4.message.includes("ne tient pas"),
    r4
  );

  const r5 = await imbriquer({ ...entree, pieces: [{ id: "dos-XL", contour: huit, quantite: 1, rotations: [0] }] });
  verifier("contour invalide refusé avant calcul", !r5.ok && r5.code === "contour_invalide" && r5.pieceId === "dos-XL", r5);

  const r6 = await imbriquer({ ...entree, tissu: { largeur_utile: 1600, marge_lisiere: 900 } });
  verifier("marge de lisière incohérente refusée", !r6.ok && r6.code === "marge_invalide", r6);

  const longue = entreeTshirt({ tailles: ["S", "M", "L", "XL"], paquets: 2, tempsMaxS: 120 });
  const calcul = lancerImbrication(longue);
  const t1 = Date.now();
  setTimeout(() => void calcul.annuler(), 3000);
  const r7 = await calcul.resultat;
  const arret = (Date.now() - t1) / 1000;
  verifier(
    `annulation : arrêt en ${arret.toFixed(1)} s avec un tracé valide`,
    r7.ok && r7.sortie.statut === "annule" && r7.validation.valide && arret < 15,
    r7.ok ? [r7.sortie.statut, r7.validation.problemes] : r7
  );

  console.log(`\n${total - echecs}/${total} vérifications réussies.`);
  if (echecs > 0) process.exit(1);
}

void main();
