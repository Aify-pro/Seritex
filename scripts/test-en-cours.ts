/**
 * Banc de test de l'en-cours (SF-1) — src/lib/production/flow.ts, miroir de
 * line_stage_flow_detail() (migration 0072).
 *
 * Vérifie :
 *  1. entrée de l'étape 1 sans coupe ni stock = répartition de tailles (P1) ;
 *  2. étape parallèle « par quantité » : sorties additionnées, reçu partagé ;
 *  3. étape parallèle « par partie » : minimum des sorties, chacun reçoit tout ;
 *  4. coupe : entrée = pièces des matelas clôturés (au moins la répartition) ;
 *  5. Entrée = Bonnes + Déchets + En cours, partout ;
 *  6. contrôle « jamais plus que l'entrée » (simulation d'une saisie) ;
 *  7. types autorisés par catégorie (seule la finition fait du 2e choix) ;
 *  8. bilan de clôture par taille.
 *
 * Lancer : npm run test:en-cours
 */
import assert from "node:assert/strict";
import {
  aggregateStages,
  allowedDeclarationTypes,
  balanceIsClosed,
  computeFlowDetail,
  firstOverDeclaration,
  isMixedStage,
  lineBalance,
  simulateDeclaration,
  stageMode,
  type FlowUnit,
} from "../src/lib/production/flow";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}

const M = "Homme/M";
const L = "Homme/L";

const serie: FlowUnit[] = [
  { id: "couture", etape: 1, categorie: "couture", partie: null },
  { id: "finition", etape: 2, categorie: "finition", partie: null },
];

test("P1 : sans coupe ni stock, l'entrée de l'étape 1 est la répartition", () => {
  const stages = aggregateStages(computeFlowDetail({ [M]: 30, [L]: 20 }, serie, {}));
  const e1 = stages.filter((s) => s.etape === 1);
  assert.deepEqual(
    e1.map((s) => [s.taille, s.entree, s.enCours]),
    [
      [M, 30, 30],
      [L, 20, 20],
    ]
  );
  assert.equal(stages.find((s) => s.etape === 2 && s.taille === M)!.entree, 0);
});

test("l'étape suivante reçoit les bonnes de la précédente", () => {
  const detail = computeFlowDetail({ [M]: 30 }, serie, {
    couture: { [M]: { bonne: 25, dechet: 5 } },
    finition: { [M]: { premier_choix: 20, deuxieme_choix: 3, dechet: 1 } },
  });
  const stages = aggregateStages(detail);
  const fin = stages.find((s) => s.etape === 2)!;
  assert.deepEqual([fin.entree, fin.premierChoix, fin.deuxiemeChoix, fin.dechets, fin.enCours], [25, 20, 3, 1, 1]);
});

test("Entrée = Bonnes + Déchets + En cours, partout", () => {
  const units: FlowUnit[] = [
    { id: "a", etape: 1, categorie: "couture", partie: null },
    { id: "b", etape: 1, categorie: "couture", partie: null },
    { id: "s", etape: 2, categorie: "impression", partie: null },
    { id: "f", etape: 3, categorie: "finition", partie: null },
  ];
  const stages = aggregateStages(
    computeFlowDetail({ [M]: 40, [L]: 12 }, units, {
      a: { [M]: { bonne: 10, dechet: 2 }, [L]: { bonne: 5 } },
      b: { [M]: { bonne: 15 } },
      s: { [M]: { bonne: 20, dechet: 1 } },
      f: { [M]: { premier_choix: 18, deuxieme_choix: 1 } },
    })
  );
  for (const s of stages) assert.equal(s.entree, s.bonnes + s.dechets + s.enCours, JSON.stringify(s));
});

test("parallèle par quantité : somme des sorties, le reçu se partage", () => {
  const units: FlowUnit[] = [
    { id: "a", etape: 1, categorie: "couture", partie: null },
    { id: "b", etape: 1, categorie: "couture", partie: null },
    { id: "f", etape: 2, categorie: "finition", partie: null },
  ];
  assert.equal(stageMode(units.slice(0, 2)), "quantite");
  const detail = computeFlowDetail({ [M]: 10 }, units, { a: { [M]: { bonne: 7 } } });
  const b = detail.find((r) => r.unitId === "b")!;
  assert.equal(b.recu, 3);
  assert.equal(b.reste, 3);
  const after = computeFlowDetail({ [M]: 10 }, units, { a: { [M]: { bonne: 7 } }, b: { [M]: { bonne: 3 } } });
  assert.equal(aggregateStages(after).find((s) => s.etape === 2)!.entree, 10);
});

test("parallèle par partie : chaque section reçoit tout, sortie = minimum", () => {
  const units: FlowUnit[] = [
    { id: "manches", etape: 1, categorie: "couture", partie: "Manches" },
    { id: "col", etape: 1, categorie: "couture", partie: "Col" },
    { id: "f", etape: 2, categorie: "finition", partie: null },
  ];
  assert.equal(stageMode(units.slice(0, 2)), "partie");
  const detail = computeFlowDetail({ [M]: 10 }, units, {
    manches: { [M]: { bonne: 10 } },
    col: { [M]: { bonne: 6 } },
  });
  assert.deepEqual(
    detail.filter((r) => r.etape === 1).map((r) => [r.unitId, r.recu, r.reste]),
    [
      ["manches", 10, 0],
      ["col", 10, 4],
    ]
  );
  const stages = aggregateStages(detail);
  assert.deepEqual(stages.map((s) => [s.etape, s.entree, s.bonnes, s.enCours]), [
    [1, 10, 6, 4],
    [2, 6, 0, 6],
  ]);
});

test("étape mixte (partie + quantité) détectée", () => {
  assert.equal(isMixedStage([{ partie: "Manches" }, { partie: null }]), true);
  assert.equal(isMixedStage([{ partie: "Manches" }, { partie: "Col" }]), false);
  assert.equal(isMixedStage([{ partie: null }]), false);
});

test("coupe : entrée = pièces des matelas clôturés (au moins la répartition)", () => {
  const units: FlowUnit[] = [
    { id: "coupe", etape: 1, categorie: "coupe", partie: null },
    { id: "couture", etape: 2, categorie: "couture", partie: null },
    { id: "f", etape: 3, categorie: "finition", partie: null },
  ];
  const detail = computeFlowDetail({ [M]: 100 }, units, { coupe: { [M]: { coupe_produit: 104, dechet: 2 } } });
  const stages = aggregateStages(detail);
  assert.deepEqual(stages.map((s) => [s.etape, s.entree, s.bonnes, s.dechets, s.enCours]), [
    [1, 104, 102, 2, 0],
    [2, 102, 0, 0, 102],
    [3, 0, 0, 0, 0],
  ]);
  const enCoupe = aggregateStages(computeFlowDetail({ [M]: 100 }, units, { coupe: { [M]: { coupe_produit: 40 } } }));
  assert.equal(enCoupe[0].enCours, 60);
});

test("jamais plus que l'entrée : une saisie trop forte est détectée avant l'envoi", () => {
  const totals = { couture: { [M]: { bonne: 25, dechet: 5 } } };
  const ok = simulateDeclaration({ [M]: 30 }, serie, totals, "finition", [{ taille: M, type: "premier_choix", quantite: 25 }]);
  assert.equal(firstOverDeclaration(ok), null);
  const ko = simulateDeclaration({ [M]: 30 }, serie, totals, "finition", [{ taille: M, type: "premier_choix", quantite: 26 }]);
  assert.equal(firstOverDeclaration(ko)?.reste, -1);
  const koCouture = simulateDeclaration({ [M]: 30 }, serie, totals, "couture", [{ taille: M, type: "dechet", quantite: 1 }]);
  assert.equal(firstOverDeclaration(koCouture)?.unitId, "couture");
});

test("types autorisés : seule la finition fait du 2e choix", () => {
  assert.deepEqual(allowedDeclarationTypes("finition"), ["premier_choix", "deuxieme_choix", "dechet"]);
  assert.deepEqual(allowedDeclarationTypes("couture"), ["bonne", "dechet"]);
  assert.deepEqual(allowedDeclarationTypes(null), ["bonne", "dechet"]);
  assert.deepEqual(allowedDeclarationTypes("coupe"), ["dechet"]);
  assert.deepEqual(allowedDeclarationTypes("stock"), ["preleve"]);
  for (const cat of ["coupe", "couture", "impression", "stock", null] as const) {
    assert.ok(!allowedDeclarationTypes(cat).includes("deuxieme_choix"));
  }
});

test("bilan de clôture : demandé, 1er/2e choix, déchets et en-cours par taille", () => {
  const rep = { [M]: 30, [L]: 20 };
  const stages = aggregateStages(
    computeFlowDetail(rep, serie, {
      couture: { [M]: { bonne: 28, dechet: 2 }, [L]: { bonne: 20 } },
      finition: { [M]: { premier_choix: 27, deuxieme_choix: 1 }, [L]: { premier_choix: 19, dechet: 1 } },
    })
  );
  const bilan = lineBalance(rep, stages);
  assert.deepEqual(
    bilan.map((b) => [b.taille, b.demande, b.premierChoix, b.deuxiemeChoix, b.dechets, b.enCours]),
    [
      [M, 30, 27, 1, 2, 0],
      [L, 20, 19, 0, 1, 0],
    ]
  );
  assert.equal(balanceIsClosed(bilan), true);
  const ouvert = lineBalance(rep, aggregateStages(computeFlowDetail(rep, serie, { couture: { [M]: { bonne: 10 } } })));
  assert.equal(balanceIsClosed(ouvert), false);
});

test("surplus déclaré avec motif : s'ajoute au reçu de la section et suit le circuit", () => {
  const detail = computeFlowDetail({ [M]: 10 }, serie, {
    couture: { [M]: { surplus: 2, bonne: 12 } },
    finition: { [M]: { premier_choix: 12 } },
  });
  const couture = detail.find((r) => r.unitId === "couture")!;
  assert.deepEqual([couture.recu, couture.bonnes, couture.reste], [12, 12, 0]);
  const finition = detail.find((r) => r.unitId === "finition")!;
  assert.deepEqual([finition.recu, finition.reste], [12, 0]);
});

console.log(`\n${n} tests OK`);
