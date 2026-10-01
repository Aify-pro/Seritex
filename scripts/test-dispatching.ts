/**
 * Banc de test du dispatching automatique des tailles (src/lib/dispatching.ts).
 *
 * Vérifie que :
 *  1. la répartition retombe toujours EXACTEMENT sur la quantité (plus forts restes) ;
 *  2. l'exemple de la grille Excel (S 1 · M 3 · L 6 · XL 5 · XXL 2 · 3XL 1 sur 18, 2 000 pièces)
 *     donne 111/333/667/556/222/111 ;
 *  3. une taille absente du modèle est retirée et les autres renormalisées ;
 *  4. le palier applicable est celui qui contient la quantité, le plus spécifique en cas de chevauchement ;
 *  5. aucune règle / quantité invalide / aucune taille commune → répartition vide (saisie manuelle).
 *
 * Lancer : npm run test:dispatching
 */
import assert from "node:assert/strict";
import { compactDispatch, dispatchGap, dispatchTotal, generateDispatch, pickRule, rulePctTotal, type DispatchRule } from "../src/lib/dispatching";

const H = (l: string) => `Homme/${l}`;
const ORDRE = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"].map(H);

const excel: DispatchRule = {
  id: "excel",
  groupe: "Homme",
  qtyMin: 1,
  qtyMax: null,
  pcts: { [H("S")]: (1 / 18) * 100, [H("M")]: (3 / 18) * 100, [H("L")]: (6 / 18) * 100, [H("XL")]: (5 / 18) * 100, [H("XXL")]: (2 / 18) * 100, [H("3XL")]: (1 / 18) * 100 },
};

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}

test("exemple Excel : 2 000 pièces", () => {
  const d = generateDispatch(2000, excel, ORDRE);
  assert.deepEqual(d, { [H("S")]: 111, [H("M")]: 333, [H("L")]: 667, [H("XL")]: 556, [H("XXL")]: 222, [H("3XL")]: 111 });
  assert.equal(dispatchTotal(d), 2000);
});

test("le total tombe juste pour toute quantité de 1 à 500", () => {
  for (let q = 1; q <= 500; q++) {
    const d = generateDispatch(q, excel, ORDRE);
    assert.equal(dispatchGap(d, q), 0, `quantité ${q}`);
    assert.ok(Object.values(d).every((v) => Number.isInteger(v) && v > 0));
  }
});

test("taille absente du modèle : retirée, les autres renormalisées", () => {
  const sansGrandes = ORDRE.filter((c) => c !== H("XXL") && c !== H("3XL"));
  const d = generateDispatch(150, excel, sansGrandes);
  assert.equal(dispatchTotal(d), 150);
  assert.equal(d[H("XXL")], undefined);
  // S 1 · M 3 · L 6 · XL 5 sur 15 → 10 / 30 / 60 / 50
  assert.deepEqual(d, { [H("S")]: 10, [H("M")]: 30, [H("L")]: 60, [H("XL")]: 50 });
});

test("ordre de sortie = ordre métier, jamais alphabétique", () => {
  const d = generateDispatch(18, excel, ORDRE);
  assert.deepEqual(Object.keys(d), [H("S"), H("M"), H("L"), H("XL"), H("XXL"), H("3XL")]);
});

test("palier : celui qui contient la quantité, le plus spécifique en cas de chevauchement", () => {
  const petit: DispatchRule = { id: "petit", groupe: "Homme", qtyMin: 1, qtyMax: 49, pcts: { [H("M")]: 50, [H("L")]: 50 } };
  const moyen: DispatchRule = { id: "moyen", groupe: "Homme", qtyMin: 50, qtyMax: null, pcts: excel.pcts };
  const chevauche: DispatchRule = { id: "chev", groupe: "Homme", qtyMin: 200, qtyMax: null, pcts: excel.pcts };
  const femme: DispatchRule = { id: "f", groupe: "Femme", qtyMin: 1, qtyMax: null, pcts: {} };
  const rules = [petit, moyen, chevauche, femme];
  assert.equal(pickRule(rules, "Homme", 10)?.id, "petit");
  assert.equal(pickRule(rules, "Homme", 49)?.id, "petit");
  assert.equal(pickRule(rules, "Homme", 50)?.id, "moyen");
  assert.equal(pickRule(rules, "Homme", 500)?.id, "chev");
  assert.equal(pickRule(rules, "Femme", 10)?.id, "f");
  assert.equal(pickRule(rules, "Enfant", 10), null);
});

test("cas limites : répartition vide plutôt qu'inventée", () => {
  assert.deepEqual(generateDispatch(0, excel, ORDRE), {});
  assert.deepEqual(generateDispatch(2.5, excel, ORDRE), {});
  assert.deepEqual(generateDispatch(100, excel, ["Femme/S"]), {});
  // Quantité inférieure au nombre de tailles : toutes les pièces sont placées, sur les plus fortes parts.
  const d = generateDispatch(2, excel, ORDRE);
  assert.equal(dispatchTotal(d), 2);
  assert.deepEqual(Object.keys(d), [H("L"), H("XL")]);
});

test("outils : total des pourcentages, compactage", () => {
  assert.equal(rulePctTotal(excel.pcts), 100);
  assert.deepEqual(compactDispatch({ a: 0, b: 3 }), { b: 3 });
});

console.log(`\n${n} tests OK`);
