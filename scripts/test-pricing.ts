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
 *     et une donnée manquante est signalée au lieu d'être comptée 0 ;
 *  6. le coût tissu calculé (ART-C, A9) : surface × grammage × prix au kg,
 *     qui change avec le grammage sans aucune grille à saisir.
 *
 * Lancer : npm run test:pricing
 */
import assert from "node:assert/strict";
import {
  coefficient,
  fabricCostPerPiece,
  purchasedSalePrice,
  printCostPerPiece,
  printSignature,
  priceGrid,
  resolveComponents,
  roundUpTo,
  salePriceForSize,
  type CostComponent,
  type FabricContext,
  type PricingParams,
} from "../src/lib/pricing";
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

test("coût tissu calculé : surface × (1 + perte) × grammage × prix au kg", () => {
  // 0,55 m² par pièce, 165 g/m², 3 500 F CFA le kg, 5 % de chutes : 0,55 × 1,05 × 0,165 × 3 500 = 333,51.
  close(fabricCostPerPiece(0.55, 165, 3500, 5), 333.506);
});

test("le coût tissu change avec le grammage, sans saisir de grille", () => {
  const comps: CostComponent[] = [
    { id: "t", libelle: "Tissu", base: 0, supplements: {}, mode: "tissu_calcule", estTissu: true },
    { id: "c", libelle: "Confection", base: 150, supplements: {} },
  ];
  const surfaces = { [M]: 0.5, [XXL]: 0.62 };
  const j165: FabricContext = { textileNom: "Jersey 165", grammage: 165, prixKg: 3000, surfaces };
  const j200: FabricContext = { textileNom: "Jersey 200", grammage: 200, prixKg: 3000, surfaces };
  const g165 = priceGrid(resolveComponents(comps, [M, XXL], j165).components, [M, XXL], jersey);
  const g200 = priceGrid(resolveComponents(comps, [M, XXL], j200).components, [M, XXL], jersey);
  close(g165.sizes[0].pr, 0.5 * 0.165 * 3000 + 150);
  close(g200.sizes[0].pr, 0.5 * 0.2 * 3000 + 150);
  assert.ok(g200.sizes[1].pr > g165.sizes[1].pr);
  assert.ok(g200.sizes[0].pvCalcule! >= g165.sizes[0].pvCalcule!);
});

test("tissu calculé : donnée manquante signalée, jamais comptée 0 en silence", () => {
  const comps: CostComponent[] = [{ id: "t", libelle: "Tissu", base: 0, supplements: {}, mode: "tissu_calcule" }];
  assert.ok(resolveComponents(comps, [M], null).warnings[0].includes("aucun textile"));
  assert.ok(resolveComponents(comps, [M], { textileNom: "J", grammage: 165, prixKg: null, surfaces: { [M]: 0.5 } }).warnings[0].includes("prix au kg"));
  const r = resolveComponents(comps, [M, XXL], { textileNom: "J", grammage: 165, prixKg: 3000, surfaces: { [M]: 0.5 } });
  assert.ok(r.warnings[0].includes("XXL"));
  // Un composant « saisi » n'est pas touché.
  assert.deepEqual(resolveComponents(modele1, [M], null).components, modele1);
});

test("coefficient de vente imposé (A8) : remplace la formule charges / marge", () => {
  close(coefficient({ chargesPct: 40, margePct: 15, coefPrixVente: 2 })!, 2);
  close(coefficient({ chargesPct: 40, margePct: 15, coefPrixVente: null })!, 1 / (0.6 * 0.85));
  const g = priceGrid([{ id: "c", libelle: "Confection", base: 1000, supplements: {} }], [M], { ...jersey, coefPrixVente: 1.75 });
  assert.equal(g.sizes[0].pvCalcule, 1800);
});

test("tissu ou consommable : prix calculé (achat + frais × coefficient) ou saisi", () => {
  // 3 000 F le kg + 10 % de frais = 3 300 ; × 1/(0,6 × 0,85) = 6 470,6 → 6 500.
  const calc = purchasedSalePrice({ mode: "calcule", prixAchat: 3000, fraisPct: 10, prixVenteSaisi: null }, jersey);
  assert.equal(calc.prixVente, 6500);
  close(calc.prixRevient!, 3300);
  assert.equal(purchasedSalePrice({ mode: "saisi", prixAchat: 3000, fraisPct: 10, prixVenteSaisi: 6000 }, jersey).prixVente, 6000);
  assert.equal(purchasedSalePrice({ mode: "calcule", prixAchat: null, fraisPct: 0, prixVenteSaisi: null }, jersey).manquant, "prix d'achat non saisi");
  assert.equal(purchasedSalePrice({ mode: "calcule", prixAchat: 1000, fraisPct: 0, prixVenteSaisi: null }, { ...jersey, coefPrixVente: 2 }).prixVente, 2000);
});

console.log(`\n${n} tests OK`);
