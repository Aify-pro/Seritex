// Scénarios SQL du lot 4 (migration 0105) : rouleau rattaché à sa
// déclinaison, code complet JE180…-178-224, stock par déclinaison.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser } = await setup();
const admin = await mkUser("administrateur");
await as(admin);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const tissu = await one(`insert into product_models(name, nature, type_appro, unite, matiere_id) values ('Jersey S','mp','negoce','kg',$1) returning id`, [jersey.id]);
const t180 = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey S',180,$1,'180',$2) returning id`, [jersey.id, tissu.id]);
const blanc = await one(`insert into colors(name, code) values ('Blanc S','#fff') returning id`);
await q(`update colors set code_court='BLS' where id=$1`, [blanc.id]);
await q(`insert into textile_sage_articles(textile_id, sage_reference, color_id) values ($1,'TJB180BLS',$2)`, [t180.id, blanc.id]);

let r1;
await test("rouleau reçu avant les déclinaisons : rattaché dès qu'elles sont générées", async () => {
  [r1] = await q(`select * from receive_rolls($1,'[{"sage_reference":"TJB180BLS","laize_cm":178,"poids_kg":22.4,"bain":"B1"}]'::jsonb)`, [t180.id]);
  assert.equal((await one(`select variant_id from textile_rolls where id=$1`, [r1.id])).variant_id, null);
  await q(`insert into product_model_colors values ($1,$2) on conflict do nothing`, [tissu.id, blanc.id]);
  await q(`select ensure_variants($1)`, [tissu.id]);
  const r = await one(`select variant_id, code_complet from textile_rolls where id=$1`, [r1.id]);
  assert.ok(r.variant_id);
  assert.equal(r.code_complet, "JE180BLS-178-224");
});

await test("rouleau reçu après : code complet posé à la réception", async () => {
  const [r2] = await q(`select * from receive_rolls($1,'[{"sage_reference":"TJB180BLS","laize_cm":180.4,"poids_kg":21,"bain":"B1"}]'::jsonb)`, [t180.id]);
  assert.equal((await one(`select code_complet from textile_rolls where id=$1`, [r2.id])).code_complet, "JE180BLS-180-210");
});

await test("stock par déclinaison : Sage et rouleaux ; la déclinaison porte la référence du coloris", async () => {
  await q(`insert into stock_item_view(sage_reference, designation, category, unit, quantity_available, warehouse, quantite_reelle, quantite_reservee) values ('TJB180BLS','Jersey blanc','tissu','KG',120,'D1',120,0)`);
  const rows = await q(`select * from article_variant_stock($1)`, [tissu.id]);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepEqual([r.code, r.libelle, r.sage_reference, Number(r.en_stock), r.rouleaux_stock, Number(r.rouleaux_kg)], [
    "JE180BLS", "180 g/m² · Blanc S", "TJB180BLS", 120, 2, 43.4,
  ]);
});

console.log("Stock des articles et code rouleau : tous les tests passent");
