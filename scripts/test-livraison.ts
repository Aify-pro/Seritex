/**
 * Banc de test de la livraison (LIV-1) — src/lib/delivery/, miroir des
 * contrôles de la base (migration 0078, scénarios SQL test-liv1.mjs).
 *
 * Vérifie : création automatique depuis la finition (reste à livrer),
 * scission et regroupement, plafond 1er choix, enchaînement des statuts
 * (validation comptable obligatoire), état de livraison d'un ODF.
 *
 * Lancer : npm run test:livraison
 */
import assert from "node:assert/strict";
import { canTransition, requiresAccountingBefore, TRANSITIONS, SHIPMENT_STATUSES, isDelivered } from "../src/lib/delivery/status";
import { capViolations, deliveryState, mergeLines, remainingToShip, splitLines } from "../src/lib/delivery/quantities";
import { carrierConnector } from "../src/lib/delivery/carriers";

let n = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    n += 1;
    console.log(`✓ ${name}`);
  });
}

const M = "Homme/M";
const L = "Homme/L";

async function main() {
  await test("création depuis la finition : tout le 1er choix est « à livrer »", () => {
    const fc = [{ lineId: "l1", taille: M, quantite: 50 }];
    assert.deepEqual(remainingToShip(fc, []), [{ lineId: "l1", taille: M, quantite: 50 }]);
    assert.deepEqual(remainingToShip(fc, [{ lineId: "l1", taille: M, quantite: 50 }]), []);
    assert.deepEqual(remainingToShip(fc, [{ lineId: "l1", taille: M, quantite: 30 }]), [{ lineId: "l1", taille: M, quantite: 20 }]);
  });

  await test("plafond : jamais plus que le 1er choix, taille par taille", () => {
    const fc = [{ lineId: "l1", taille: M, quantite: 50 }];
    assert.deepEqual(capViolations(fc, [{ lineId: "l1", taille: M, quantite: 50 }]), []);
    assert.deepEqual(capViolations(fc, [{ lineId: "l1", taille: M, quantite: 30 }, { lineId: "l1", taille: M, quantite: 25 }]), [
      { lineId: "l1", taille: M, quantite: 5 },
    ]);
    assert.deepEqual(capViolations(fc, [{ lineId: "l1", taille: L, quantite: 1 }]), [{ lineId: "l1", taille: L, quantite: 1 }]);
  });

  await test("scission : les quantités changent d'expédition, rien ne se perd", () => {
    const r = splitLines([{ lineId: "l1", taille: M, quantite: 20 }, { lineId: "l1", taille: L, quantite: 5 }], [
      { lineId: "l1", taille: M, quantite: 8 },
    ]);
    assert.deepEqual(r.nouvelle, [{ lineId: "l1", taille: M, quantite: 8 }]);
    assert.deepEqual(r.source, [
      { lineId: "l1", taille: M, quantite: 12 },
      { lineId: "l1", taille: L, quantite: 5 },
    ]);
    assert.throws(() => splitLines([{ lineId: "l1", taille: M, quantite: 5 }], [{ lineId: "l1", taille: M, quantite: 6 }]), /que 5/);
    assert.throws(() => splitLines([{ lineId: "l1", taille: M, quantite: 5 }], [{ lineId: "l1", taille: M, quantite: 5 }]), /viderait/);
  });

  await test("regroupement : seulement pour un même client, quantités additionnées", () => {
    const merged = mergeLines(
      { companyId: "c1", lines: [{ lineId: "l1", taille: M, quantite: 12 }] },
      { companyId: "c1", lines: [{ lineId: "l1", taille: M, quantite: 8 }, { lineId: "l2", taille: M, quantite: 3 }] }
    );
    assert.deepEqual(merged, [
      { lineId: "l1", taille: M, quantite: 20 },
      { lineId: "l2", taille: M, quantite: 3 },
    ]);
    assert.throws(() => mergeLines({ companyId: "c1", lines: [] }, { companyId: "c2", lines: [] }), /clients différents/);
  });

  await test("statuts : validation comptable obligatoire avant tout départ", () => {
    assert.equal(canTransition("preparee", "planifiee", "service", "livraison"), false);
    assert.equal(canTransition("preparee", "validee_compta", "service", "livraison"), false);
    assert.equal(canTransition("preparee", "validee_compta", "compta", "livraison"), true);
    assert.equal(canTransition("validee_compta", "planifiee", "service", "livraison"), true);
    assert.equal(canTransition("validee_compta", "planifiee", "service", "retrait"), false);
    assert.equal(canTransition("validee_compta", "prete_a_enlever", "service", "retrait"), true);
    // Aucun chemin vers un départ ne contourne validee_compta.
    for (const s of ["a_preparer", "preparee"] as const) {
      for (const t of TRANSITIONS[s]) assert.ok(!requiresAccountingBefore(t.to), `${s} → ${t.to}`);
    }
  });

  await test("statuts : le livreur ne fait que en route / livrée / échec", () => {
    assert.equal(canTransition("planifiee", "en_route", "livreur", "livraison"), true);
    assert.equal(canTransition("en_route", "livree", "livreur", "livraison"), true);
    assert.equal(canTransition("en_route", "echec", "livreur", "livraison"), true);
    assert.equal(canTransition("validee_compta", "planifiee", "livreur", "livraison"), false);
    assert.equal(canTransition("prete_a_enlever", "enlevee", "livreur", "retrait"), false);
    for (const s of SHIPMENT_STATUSES) for (const t of TRANSITIONS[s]) if (t.by.includes("livreur")) assert.ok(["en_route", "livree", "echec"].includes(t.to));
  });

  await test("BL : livrée ou enlevée = marchandise sortie (sortie de stock au BL)", () => {
    assert.equal(isDelivered("livree"), true);
    assert.equal(isDelivered("enlevee"), true);
    assert.equal(isDelivered("en_route"), false);
  });

  await test("état de livraison d'un ODF", () => {
    assert.equal(deliveryState(100, 0, 0), "non_livre");
    assert.equal(deliveryState(100, 100, 50), "partiel");
    assert.equal(deliveryState(100, 102, 102), "livre");
  });

  await test("connecteur transporteur : seul « manuel » en version 1", async () => {
    const c = carrierConnector("manuel");
    assert.deepEqual(await c.creer({ shipmentId: "s", reference: null, destination: { libelle: null, latitude: null, longitude: null, contact: null, telephone: null }, colis: 1, poidsKg: null }), { carrierRef: null });
    assert.throws(() => carrierConnector("yango"), /e-shop/);
  });

  console.log(`\n${n} tests OK`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
