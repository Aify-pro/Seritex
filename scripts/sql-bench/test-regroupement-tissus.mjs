// Scénarios SQL du regroupement des tissus (migration 0103) : proposition par
// matière, regroupement validé, déclinaisons et couleurs suivies, articles
// vidés désactivés, rouleaux et produits finis intacts.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const pique = await one(`insert into matieres(nom, code_court) values ('Piqué','PI') returning id`);
const t165 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 165',165,$1,'165') returning id, product_model_id`, [jersey.id]);
const t180 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 180',180,$1,'180') returning id, product_model_id`, [jersey.id]);
await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Piqué 220',220,$1,'220') returning id`, [pique.id]);
const blanc = await one(`insert into colors(name, code) values ('Blanc G','#fff') returning id`);
await q(`update colors set code_court='BLG' where id=$1`, [blanc.id]);

await test("proposition : les tissus Jersey (deux articles) sous « Jersey » ; le Piqué seul n'est pas proposé", async () => {
  const props = await q(`select matiere, nom_propose, textiles from textile_grouping_proposals()`);
  assert.equal(props.length, 1);
  assert.equal(props[0].nom_propose, "Jersey");
  assert.deepEqual(props[0].textiles.map((t) => Number(t.grammage)), [165, 180]);
});

let cible;
await test("regroupement validé : un article, deux grammages, déclinaisons et couleurs suivies", async () => {
  // Déclinaison déjà générée sur l'article « Jersey 180 », un rouleau, un produit fini.
  await q(`insert into product_model_colors values ($1,$2)`, [t180.product_model_id, blanc.id]);
  await q(`select ensure_variants($1)`, [t180.product_model_id]);
  const roll = await one(`select * from receive_rolls($1,'[{"poids_kg":20}]'::jsonb)`, [t180.id]);
  const pf = await one(`insert into product_models(name, textile_id) values ('T-shirt G',$1) returning id`, [t165.id]);
  await expectFail(() => q(`select group_textiles('Jersey', $1::uuid[])`, [[t165.id]]), /au moins deux/);
  cible = (await one(`select group_textiles('Jersey', $1::uuid[], $2) id`, [[t165.id, t180.id], t165.product_model_id])).id;
  assert.equal(cible, t165.product_model_id);
  const noms = (await q(`select nom from textiles where product_model_id=$1 order by grammage`, [cible])).map((r) => r.nom);
  assert.deepEqual(noms, ["Jersey 165 g", "Jersey 180 g"]);
  assert.equal((await one(`select name from product_models where id=$1`, [cible])).name, "Jersey");
  assert.equal((await one(`select count(*)::int n from product_variants where model_id=$1`, [cible])).n, 1);
  assert.equal((await one(`select count(*)::int n from product_model_colors where product_model_id=$1`, [cible])).n, 1);
  const absorbe = await one(`select active, fusionne_dans from product_models where id=$1`, [t180.product_model_id]);
  assert.deepEqual([absorbe.active, absorbe.fusionne_dans], [false, cible]);
  // Rouleau et produit fini restent liés à leurs grammages.
  assert.equal((await one(`select textile_id from textile_rolls where id=$1`, [roll.id])).textile_id, t180.id);
  assert.equal((await one(`select textile_id from product_models where id=$1`, [pf.id])).textile_id, t165.id);
  // Déclinaisons de l'article regroupé : grammage × couleur.
  await q(`select ensure_variants($1)`, [cible]);
  assert.deepEqual((await q(`select code from product_variants where model_id=$1 and actif order by code`, [cible])).map((r) => r.code), ["JE165BLG", "JE180BLG"]);
  assert.equal((await q(`select * from textile_grouping_proposals()`)).length, 0);
});

await test("garde-fous : deux fois le même grammage, ou un article qui n'est pas un tissu", async () => {
  const autre = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 180 bis',180,$1,'18B') returning id`, [jersey.id]);
  const t180b = await one(`select id from textiles where product_model_id=$1 and grammage=180`, [cible]);
  await expectFail(() => q(`select group_textiles('Jersey', $1::uuid[])`, [[autre.id, t180b.id]]), /même grammage/);
});

console.log("Regroupement des tissus : tous les tests passent");
