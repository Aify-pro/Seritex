// Scénarios SQL du lot ART-A (migration 0073) : module « articles », patron
// forcément rattaché à un modèle.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, expectFail } = await setup();

await test("module articles : droits par défaut", async () => {
  const rows = await q(`select r.key, rp.can_view, rp.can_modify from role_permissions rp join roles r on r.id=rp.role_id join modules m on m.id=rp.module_id where m.key='articles' order by r.key`);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.administrateur.can_modify, true);
  assert.equal(by.responsable_production.can_modify, true);
  assert.equal(by.commercial.can_view, true);
  assert.equal(by.commercial.can_modify, false);
  assert.equal(by.chef_section.can_view, false);
});

await test("un nouveau patron sans modèle est refusé", async () => {
  await expectFail(() => q(`insert into pattern_articles(article_code, designation) values ('X1','Sans modèle')`), /pattern_articles_modele_obligatoire/);
  const m = await one(`insert into product_models(name) values ('Polo') returning id`);
  await q(`insert into pattern_articles(article_code, designation, product_model_id) values ('P1','Polo',$1)`, [m.id]);
});

await test("contrainte validée quand aucune ligne n'est orpheline", async () => {
  const c = await one(`select convalidated from pg_constraint where conname='pattern_articles_modele_obligatoire'`);
  assert.equal(c.convalidated, true);
});
console.log("ART-A : tous les tests passent");
