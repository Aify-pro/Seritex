// Scénarios SQL du lot ART-F (migration 0088) : médias d'un modèle, image
// principale par couleur, ordre, suppression, droits.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const chef = await mkUser("chef_section", { section_id: (await one(`select id from sections where name='Coupe'`)).id });
await as(admin);
const model = await one(`insert into product_models(name) values ('Polo F') returning id`);
const blanc = await one(`insert into colors(name, code) values ('Blanc F','#fff') returning id`);
const noir = await one(`insert into colors(name, code) values ('Noir F','#000') returning id`);
await q(`insert into product_model_colors values ($1,$2),($1,$3)`, [model.id, blanc.id, noir.id]);
const add = (color, n) => one(`select record_product_model_media($1,$2,$3,'image/jpeg',$4) id`, [model.id, `modeles/${model.id}/${n}.jpg`, `${n}.jpg`, color]);

let a, b, c;
await test("première image d'une couleur = principale ; une seule principale par couleur", async () => {
  a = (await add(blanc.id, "a")).id;
  b = (await add(blanc.id, "b")).id;
  c = (await add(noir.id, "c")).id;
  const rows = await q(`select id, principale, ordre from product_model_media where product_model_id=$1 order by ordre`, [model.id]);
  assert.deepEqual(rows.map((r) => [r.principale, r.ordre]), [[true, 0], [false, 1], [true, 2]]);
  await q(`select set_product_model_media_principale($1)`, [b]);
  assert.equal((await one(`select count(*)::int n from product_model_media where principale and color_id=$1`, [blanc.id])).n, 1);
  assert.equal((await one(`select principale from product_model_media where id=$1`, [b])).principale, true);
});

await test("ordre, suppression (la principale passe à la suivante), chemins contrôlés", async () => {
  await q(`select reorder_product_model_media($1,$2::uuid[])`, [model.id, [c, b, a]]);
  assert.deepEqual((await q(`select id from product_model_media where product_model_id=$1 order by ordre`, [model.id])).map((r) => r.id), [c, b, a]);
  const path = (await one(`select delete_product_model_media($1) p`, [b])).p;
  assert.match(path, /\/b\.jpg$/);
  assert.equal((await one(`select principale from product_model_media where id=$1`, [a])).principale, true);
  await expectFail(() => one(`select record_product_model_media($1,'ailleurs/x.jpg','x','image/jpeg',null)`, [model.id]), /chemin/);
  const autre = await one(`insert into colors(name, code) values ('Rouge F','#f00') returning id`);
  await expectFail(() => add(autre.id, "d"), /pas déclarée/);
});

await test("réservé à qui modifie les articles ; texte commercial et e-shop", async () => {
  await as(chef);
  await expectFail(() => add(null, "e"), /accès refusé/);
  await as(admin);
  await q(`update product_models set texte_commercial='Polo piqué', publiable_eshop=true where id=$1`, [model.id]);
  assert.equal((await one(`select publiable_eshop from product_models where id=$1`, [model.id])).publiable_eshop, true);
});

console.log("ART-F : tous les tests passent");
