/**
 * Banc de test du prix de revient réel (src/lib/real-cost.ts).
 *
 * Vérifie que :
 *  1. seul le tissu change : PR réel = PR théorique − tissu théorique + kg pesés × prix au kg ;
 *  2. les kg théoriques se déduisent du tissu théorique et du prix au kg ;
 *  3. la marge réelle reflète le surcoût tissu, charges du modèle appliquées ;
 *  4. sans pesée ou sans prix au kg, le réel reste inconnu (jamais 0) ;
 *  5. une ligne sans théorique est exclue et signalée.
 *
 * Lancer : npm run test:real-cost
 */
import assert from "node:assert/strict";
import { computeRealCost, type TheoreticalRow } from "../src/lib/real-cost";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}
const close = (a: number | null | undefined, b: number, eps = 0.01) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// Modèle 1 Jersey de l'Excel : PR 778,39 dont tissu 638,35 ; vendu 1 600 ; charges 40 %.
const m1: TheoreticalRow = { quantite: 1000, prixVenteXof: 1600, prixRevient: 778.39, tissu: 638.35, chargesPct: 40 };
// Prix rendu au kg de l'Excel (Dark, douane 19 %) : 3 755 × 1,19 = 4 468,45 → 7 pièces/kg.
const prixKg = 4468.45;

test("tissu consommé exactement comme prévu : réel = théorique", () => {
  const kgPrevus = (1000 * 638.35) / prixKg; // 142,857 kg
  const r = computeRealCost({ rows: [m1], kgMesures: kgPrevus, prixKg });
  close(r.kgTheoriques, 142.857, 0.001);
  close(r.reel?.prixRevient, 778390);
  close(r.ecart, 0);
});

test("10 % de tissu en plus : seul le tissu augmente", () => {
  const r = computeRealCost({ rows: [m1], kgMesures: 157.143, prixKg });
  close(r.tissuReel, 702187, 5);
  close(r.ecart, 63835, 5);
  close(r.ecartPct, 8.2, 0.05);
  // Marge théorique : (1 600 000 − 778 390 / 0,6) / 1 600 000 = 18,9 %
  close(r.theorique.margePct, 18.92, 0.01);
  // Marge réelle : le surcoût de 63 835 coûte 106 392 après charges → 12,3 %
  close(r.reel?.margePct, 12.27, 0.02);
});

test("sans pesée ou sans prix au kg : réel inconnu, jamais 0", () => {
  const sansPesee = computeRealCost({ rows: [m1], kgMesures: null, prixKg });
  assert.equal(sansPesee.reel, null);
  assert.ok(sansPesee.warnings.some((w) => w.includes("pesée")));
  const sansPrix = computeRealCost({ rows: [m1], kgMesures: 150, prixKg: null });
  assert.equal(sansPrix.reel, null);
  assert.equal(sansPrix.kgTheoriques, null);
});

test("ligne sans théorique : exclue et signalée", () => {
  const r = computeRealCost({ rows: [m1, { quantite: 50, prixVenteXof: 2000, prixRevient: null, tissu: 0, chargesPct: 40 }], kgMesures: 150, prixKg });
  assert.equal(r.quantite, 1000);
  assert.equal(r.piecesSansTheorique, 50);
  assert.equal(r.chiffreAffaires, 1600000);
});

test("aucun composant tissu : signalé", () => {
  const r = computeRealCost({ rows: [{ ...m1, tissu: 0 }], kgMesures: 150, prixKg });
  assert.ok(r.warnings.some((w) => w.includes("tissu")));
});

console.log(`\n${n} tests OK`);
