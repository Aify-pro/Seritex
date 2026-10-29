// Scénarios SQL de l'entrée en stock des rouleaux par lots (migration 0154) :
// lot en brouillon, pesées sérialisées, annulation motivée, correction de
// poids, validation, totaux et valeur, droits, étiquettes.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const gest = await mkUser("gestionnaire_stock");
const commercial = await mkUser("commercial");
await as(admin);
const jersey = await one(`insert into textiles(nom, grammage) values ('Jersey 180 L', 180) returning id`);
const blanc = await one(`insert into colors(name, code) values ('Blanc L','#fff') returning id`);
await q(`insert into textile_sage_articles(textile_id, sage_reference, color_id) values ($1,'TJB180L',$2)`, [jersey.id, blanc.id]);

const donnees = { supplier: "", sage_reference: "TJB180L", internal_code: "JE-INT-1", dye_batch_number: "18 P04", grammage: 180, laize_cm: 178, unit_cost: 2500 };
let lot, a, b, c;

await test("lot : droits, référence ENT-, valeurs par défaut et champs obligatoires", async () => {
  await as(commercial);
  await expectFail(() => q(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify(donnees)]), /gestion de stock/);
  await as(gest);
  lot = await one(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify(donnees)]);
  assert.match(lot.reference, /^ENT-\d{4}-\d{4}$/);
  assert.equal(lot.supplier, "Seritex");
  assert.equal(lot.status, "draft");
  assert.equal(lot.textile_id, jersey.id);
  assert.equal(lot.color_id, blanc.id);
  await expectFail(() => q(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify({ ...donnees, sage_reference: "INCONNU" })]), /aucun tissu/);
  await expectFail(() => q(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify({ ...donnees, dye_batch_number: "" })]), /dye_batch_number|check/);
  await expectFail(() => q(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify({ ...donnees, unit_cost: null })]), /unit_cost|null/);
});

await test("pesées : une pesée = un rouleau ROL-, constantes héritées", async () => {
  a = await one(`select * from add_receipt_roll($1, 22.5)`, [lot.id]);
  b = await one(`select * from add_receipt_roll($1, 21.8)`, [lot.id]);
  c = await one(`select * from add_receipt_roll($1, 20)`, [lot.id]);
  assert.match(a.code, /^ROL-\d{4}-\d{5}$/);
  assert.notEqual(a.code, b.code);
  assert.deepEqual([a.bain, Number(a.laize_cm), a.statut, a.receipt_id, a.label_printed_at, a.label_print_count], ["18 P04", 178, "en_stock", lot.id, null, 0]);
  await expectFail(() => q(`select * from add_receipt_roll($1, 0)`, [lot.id]), /supérieur à 0/);
  await expectFail(() => q(`select * from add_receipt_roll($1, -3)`, [lot.id]), /supérieur à 0/);
  const ev = await one(`select count(*)::int as n from textile_roll_events where roll_id=$1 and type='reception'`, [a.id]);
  assert.equal(ev.n, 1);
});

await test("correction de poids avant impression de l'étiquette, refusée après", async () => {
  const r = await one(`select * from set_receipt_roll_weight($1, 22.7)`, [a.code]);
  assert.equal(Number(r.poids_initial_kg), 22.7);
  assert.equal(Number(r.poids_kg), 22.7);
  assert.equal(await one(`select mark_roll_labels_printed(array[$1]) as n`, [a.code]).then((x) => x.n), 1);
  await expectFail(() => q(`select * from set_receipt_roll_weight($1, 23)`, [a.code]), /déjà imprimée/);
  const p = await one(`select label_printed_at, label_print_count from textile_rolls where id=$1`, [a.id]);
  assert.ok(p.label_printed_at);
  assert.equal(p.label_print_count, 1);
  await q(`select mark_roll_labels_printed(array[$1])`, [a.code]);
  assert.equal((await one(`select label_print_count from textile_rolls where id=$1`, [a.id])).label_print_count, 2);
});

await test("annulation : motif obligatoire, code jamais réutilisé, exclu des totaux", async () => {
  await expectFail(() => q(`select * from cancel_receipt_roll($1, '  ')`, [c.code]), /motif/);
  const r = await one(`select * from cancel_receipt_roll($1, 'Pesée erronée')`, [c.code]);
  assert.equal(r.statut, "annule");
  assert.equal(r.cancelled_reason, "Pesée erronée");
  const d = await one(`select * from add_receipt_roll($1, 20)`, [lot.id]);
  assert.notEqual(d.code, c.code);
  assert.ok(d.code > c.code);
  await expectFail(() => q(`select * from cancel_receipt_roll($1, 'encore')`, [c.code]), /déjà entamé|sorti/);
  const s = await one(`select * from stock_receipt_summary where id=$1`, [lot.id]);
  // 22,7 + 21,8 + 20 (le rouleau annulé n'est pas compté)
  assert.equal(s.roll_count, 3);
  assert.equal(Number(s.total_kg), 64.5);
  assert.equal(Number(s.total_value), 161250);
});

await test("terminer le lot : récapitulatif, plus d'ajout possible, audit", async () => {
  const sum = await one(`select * from validate_stock_receipt($1)`, [lot.id]);
  assert.deepEqual([sum.reference, sum.roll_count, Number(sum.total_kg), Number(sum.total_value)], [lot.reference, 3, 64.5, 161250]);
  assert.equal((await one(`select status from stock_receipts where id=$1`, [lot.id])).status, "validated");
  await expectFail(() => q(`select * from add_receipt_roll($1, 20)`, [lot.id]), /terminé/);
  const audit = await q(`select action from audit_log where entity_type in ('stock_receipt','textile_roll') order by occurred_at, id`);
  for (const act of ["creer_lot_entree", "creer_rouleau", "corriger_poids_rouleau", "annuler_rouleau", "valider_lot_entree"]) {
    assert.ok(audit.some((x) => x.action === act), `audit manquant : ${act}`);
  }
  const vide = await one(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify(donnees)]);
  await expectFail(() => q(`select * from validate_stock_receipt($1)`, [vide.id]), /aucun rouleau/);
});

await test("rouleau sorti du stock : annulation refusée ; paramétrage et case libre", async () => {
  await q(`update textile_rolls set poids_kg = 10 where id=$1`, [b.id]);
  await expectFail(() => q(`select * from cancel_receipt_roll($1, 'x')`, [b.code]), /déjà entamé|sorti/);
  const s = await one(`select * from label_print_settings where user_id is null`);
  assert.deepEqual([s.columns, s.rows, s.auto_print, s.next_slot], [2, 4, false, 1]);
  assert.equal((await one(`select set_next_label_slot(5) as n`)).n, 5);
  assert.equal((await one(`select set_next_label_slot(9) as n`)).n, 1); // feuille pleine → neuve
  await as(commercial);
  await expectFail(() => q(`select set_next_label_slot(2)`), /gestion de stock/);
  assert.equal((await q(`select 1 from stock_receipts`)).length >= 2, true);
});
console.log("Entrée des rouleaux (lots) : tous les tests passent");
