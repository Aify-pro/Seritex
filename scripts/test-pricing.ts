/**
 * Banc de test du moteur de tarification (src/lib/pricing.ts).
 *
 * Vérifie que :
 *  1. le Modèle 1 Jersey de la grille Excel V7 est reproduit au centime :
 *     PR 778,39 → coût après charges 1 297,32 → PV 1 526,25 → arrondi 1 600 F CFA ;
 *  2. le coefficient est celui de l'Excel : 1,96 en Jersey (40 % / 15 %), 2,78 en Piqué (55 % / 20 %) ;
 *  3. les suppléments par taille ne s'appliquent qu'aux tailles concernées ;
 *  4. un prix forcé remplace le calcul et la marge réelle le reflète ;
 *  5. les impressions : coût par nombre de couleurs + frais d'écran amortis,
 *     et une donnée manquante est signalée au lieu d'être comptée 0.
 *
 * Lancer : npm run test:pricing
 */
import assert from "node:assert/strict";
import { coefficient, printCostPerPiece, printSignature, priceGrid, roundUpTo, salePriceForSize, type CostComponent, type PricingParams } from "../src/lib/pricing";
import { averageUnitPrice, computeQuoteTotals, lineNet } from "../src/lib/quote-totals";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}
const close = (a: number | null, b: number, eps = 0.01) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const jersey: PricingParams = { chargesPct: 40, margePct: 15, arrondi: 100 };
const M = "Homme/M";
const XXL = "Homme/XXL";
const X3 = "Homme/3XL";

// Modèle 1 Jersey de l'Excel : corps 3 755 × 1,19 / 7 jeux = 638,35 ; col 30,04 ; sérigraphie recto + verso 2 × 55.
const modele1: CostComponent[] = [
  { id: "tissu", libelle: "Tissu", base: 638.35, supplements: {} },
  { id: "col", libelle: "Col", base: 30.04, supplements: {} },
];
const seriExcel = { coutParNbCouleurs: { 1: 55, 2: 55, 3: 55 }, fraisEcranParCouleur: 0 };

test("Modèle 1 Jersey de l'Excel : 1 600 F CFA", () => {
  const prints = printCostPerPiece([{ label: "Recto", nbCouleurs: 1 }, { label: "Verso", nbCouleurs: 1 }], seriExcel, 2000);
  assert.equal(prints.cost, 110);
  const g = priceGrid(modele1, [M], jersey, { extraCostPerPiece: prints.cost });
  close(g.sizes[0].pr, 778.39);
  assert.equal(g.sizes[0].pvCalcule, 1600);
  // Prix exact avant arrondi : 1 526,25 (cellule M22 de l'Excel).
  close(g.sizes[0].pr * g.coefficient!, 1526.25);
});

test("coefficients de l'Excel", () => {
  close(coefficient(jersey), 1.9608, 0.0001);
  close(coefficient({ chargesPct: 55, margePct: 20 }), 2.7778, 0.0001);
  assert.equal(coefficient({ chargesPct: 100, margePct: 10 }), null);
});

test("arrondi à la centaine supérieure, sans faux dépassement", () => {
  assert.equal(roundUpTo(1526.25, 100), 1600);
  assert.equal(roundUpTo(1600, 100), 1600);
  assert.equal(roundUpTo(1600.0000000001, 100), 1600);
  assert.equal(roundUpTo(1601, 100), 1700);
});

test("base + supplément par taille", () => {
  const comps: CostComponent[] = [
    { id: "t", libelle: "Tissu", base: 640, supplements: { [XXL]: 90, [X3]: 140 } },
    { id: "c", libelle: "Col", base: 36, supplements: { [XXL]: 5, [X3]: 8 } },
    { id: "f", libelle: "Confection", base: 150, supplements: { [X3]: 20 } },
    { id: "ch", libelle: "Charges fixes", base: 200, supplements: {} },
  ];
  const g = priceGrid(comps, [M, XXL, X3], jersey);
  assert.deepEqual(
    g.sizes.map((s) => s.pr),
    [1026, 1121, 1194]
  );
  assert.deepEqual(
    g.sizes.map((s) => s.pvCalcule),
    [2100, 2200, 2400]
  );
});

test("prix forcé : remplace le calcul, marge réelle recalculée", () => {
  const g = priceGrid(modele1, [M], jersey, { forced: { [M]: 1300 }, extraCostPerPiece: 110 });
  assert.equal(g.sizes[0].pv, 1300);
  assert.equal(g.sizes[0].pvCalcule, 1600);
  // Coût après charges 1 297,32 → il ne reste que 0,2 % de marge à 1 300.
  close(g.sizes[0].margeReellePct, 0.21, 0.01);
  // Au prix calculé, la marge cible est dépassée (arrondi) : ≥ 15 %.
  const calc = priceGrid(modele1, [M], jersey, { extraCostPerPiece: 110 });
  assert.ok(calc.sizes[0].margeReellePct! >= 15);
});

test("impressions : frais d'écran amortis et données manquantes signalées", () => {
  const grid = { coutParNbCouleurs: { 1: 55, 2: 80 }, fraisEcranParCouleur: 5000 };
  const ok = printCostPerPiece([{ label: "Devant", nbCouleurs: 2 }, { label: "Dos", nbCouleurs: 1 }], grid, 500);
  // 80 + 55 + 3 écrans × 5 000 / 500 = 165
  assert.equal(ok.cost, 165);
  assert.deepEqual(ok.warnings, []);
  const ko = printCostPerPiece([{ label: "Manche", nbCouleurs: 4 }], grid, 0);
  assert.equal(ko.warnings.length, 2);
});

test("modèle sans composant : signalé, pas de prix à 0 silencieux", () => {
  const g = priceGrid([], [M], jersey);
  assert.ok(g.warnings.some((w) => w.includes("Aucun composant")));
});

test("prix d'une taille avec impressions : calculé, ou forcé + impressions majorées", () => {
  // Calculé : (668,39 + 110) × 1,9608 = 1 526,25 → 1 600, identique à l'Excel.
  assert.deepEqual(salePriceForSize(modele1, M, jersey, 110).pv, 1600);
  // Forcé à 1 300 sur l'article nu : 1 300 + 110 × 1,9608 = 1 515,69 → 1 600.
  assert.equal(salePriceForSize(modele1, M, jersey, 110, 1300).pv, 1600);
  // Forcé, sans impression : le prix forcé tel quel.
  assert.equal(salePriceForSize(modele1, M, jersey, 0, 1300).pv, 1300);
});

test("signature d'impression : indépendante de l'ordre de saisie", () => {
  const a = printSignature([{ printable_zone_id: "b-dos", nb_couleurs: 1 }, { printable_zone_id: "a-devant", nb_couleurs: 2 }]);
  const b = printSignature([{ printable_zone_id: "a-devant", nb_couleurs: 2 }, { printable_zone_id: "b-dos", nb_couleurs: 1 }]);
  assert.equal(a, "a-devant:2,b-dos:1");
  assert.equal(a, b);
  assert.equal(printSignature([]), "");
});

test("montants d'un devis chiffré par taille : le total suit la répartition", () => {
  const prix = { [M]: 1600, [XXL]: 1800 };
  const ligne = { quantity: 100, unit_price: 0, sizes: { [M]: 80, [XXL]: 20 }, size_prices: prix };
  assert.equal(lineNet(ligne), 80 * 1600 + 20 * 1800);
  // Le client déplace 10 pièces vers le XXL : +2 000 F CFA.
  const modifiee = { ...ligne, sizes: { [M]: 70, [XXL]: 30 } };
  assert.equal(lineNet(modifiee) - lineNet(ligne), 2000);
  assert.equal(averageUnitPrice(modifiee), 1660);
  const t = computeQuoteTotals([modifiee, { quantity: 2, unit_price: 500 }], 0, 18);
  assert.equal(t.ht, 166000 + 1000);
  assert.equal(t.tva, Math.round(167000 * 0.18));
});

console.log(`\n${n} tests OK`);
