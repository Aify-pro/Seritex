// Scénarios SQL du lot SF-3 (migration 0081) : demande sans client → ODF de
// stock, validé sans attestation comptable, sans expédition.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const prod = await mkUser("responsable_production");
const commercial = await mkUser("commercial");
const chef = await mkUser("chef_section", { section_id: (await one(`select id from sections where name='Coupe'`)).id });
const model = await one(`insert into product_models(name) values ('T-shirt vierge') returning id`);
const blanc = await one(`insert into colors(name, code) values ('Blanc', '#fff') returning id`);
const lignes = JSON.stringify([{ product_model_id: model.id, description: "T-shirt blanc", couleur_unique_id: blanc.id, tailles: { "Homme/M": 100, "Homme/L": 50 } }]);

let req, po;
await test("demande pour le stock : commerciaux, production, Direction — pas les autres", async () => {
  await as(chef);
  await expectFail(() => q(`select create_stock_request('x', $1::jsonb)`, [lignes]), /accès refusé/);
  await as(commercial);
  req = (await one(`select create_stock_request('Réassort blanc', $1::jsonb) id`, [lignes])).id;
  const r = await one(`select reference, company_id from requests where id=$1`, [req]);
  assert.match(r.reference, /^DST-\d{4}-0001$/);
  assert.equal(r.company_id, null);
});

await test("ODF de stock créé depuis la demande (OFS-…, sans client)", async () => {
  await as(prod);
  po = (await one(`select create_stock_production_order($1) id`, [req])).id;
  const o = await one(`select reference, company_id, total_quantity, request_id, status from production_orders where id=$1`, [po]);
  assert.match(o.reference, /^OFS-\d{4}-0001$/);
  assert.deepEqual([o.company_id, o.total_quantity, o.request_id, o.status], [null, 150, req, "brouillon"]);
  await expectFail(() => q(`select create_stock_production_order($1)`, [req]), /existe déjà/);
});

await test("soumis et validé sans attestation comptable ; aucune expédition au 1er choix", async () => {
  await as(prod);
  await q(`select submit_production_order($1)`, [po]);
  await as(admin);
  await q(`select validate_production_order($1)`, [po]);
  const fin = await one(`select w.id from work_orders w join production_order_lines l on l.id=w.production_order_line_id where l.production_order_id=$1`, [po]);
  await q(`select declare_production($1,'Homme/M','premier_choix',100)`, [fin.id]);
  assert.equal((await one(`select count(*)::int n from shipments`)).n, 0);
});

await test("un ODF client exige toujours l'attestation comptable", async () => {
  await as(admin);
  const c = (await one(`insert into companies(name) values ('Client') returning id`)).id;
  const o = await one(`insert into production_orders(reference, company_id, total_quantity) values ('OF-X',$1,10) returning id`, [c]);
  const l = await one(`insert into production_order_lines(production_order_id, product_model_id, description, quantity, couleur_unique_id) values ($1,$2,'X',10,$3) returning id`, [o.id, model.id, blanc.id]);
  await q(`insert into production_order_sizes(production_order_line_id, taille, quantite_demandee) values ($1,'Homme/M',10)`, [l.id]);
  await expectFail(() => q(`select submit_production_order($1)`, [o.id]), /validation comptabilité/);
});
console.log("SF-3 : tous les tests passent");
