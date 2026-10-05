// Scénarios SQL de la fiche article unique (migration 0093) : familles à deux
// niveaux, nature et type sur chaque article, textiles et consommables reliés
// à leur article, synchronisation du nom, de l'état et de l'unité.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

let tex, merc, jersey, vet;
await test("familles : deux niveaux, noms uniques par niveau", async () => {
  tex = await one(`insert into article_families(nom) values ('Textile') returning id`);
  merc = await one(`insert into article_families(nom) values ('Mercerie') returning id`);
  vet = await one(`insert into article_families(nom) values ('Vêtements') returning id`);
  jersey = await one(`insert into article_families(nom, parent_id) values ('Jersey',$1) returning id`, [tex.id]);
  await expectFail(() => q(`insert into article_families(nom, parent_id) values ('Fin',$1)`, [jersey.id]), /deux niveaux/);
  await expectFail(() => q(`insert into article_families(nom) values ('textile')`), /unique/);
  await q(`insert into article_families(nom, parent_id) values ('Jersey',$1)`, [merc.id]); // même nom, autre famille
});

await test("un produit fini par défaut : nature pf, fabriqué, à la pièce ; sous-famille cohérente", async () => {
  const m = await one(`insert into product_models(name) values ('T-shirt') returning nature, type_appro, unite`);
  assert.deepEqual([m.nature, m.type_appro, m.unite], ["pf", "fabrique", "piece"]);
  const f = await one(`insert into product_models(name, sous_famille_id) values ('Polo',$1) returning famille_id`, [jersey.id]);
  assert.equal(f.famille_id, tex.id); // famille déduite de la sous-famille
  await expectFail(() => q(`insert into product_models(name, famille_id, sous_famille_id) values ('X',$1,$2)`, [vet.id, jersey.id]), /n'appartient pas/);
  await expectFail(() => q(`insert into product_models(name, nature) values ('X','service')`), /nature_valide/);
});

await test("un textile créé par l'ancien chemin reçoit son article (MP, négoce, kg)", async () => {
  const t = await one(`insert into textiles(nom, grammage) values ('Jersey 180', 180) returning product_model_id`);
  const a = await one(`select name, nature, type_appro, unite from product_models where id=$1`, [t.product_model_id]);
  assert.deepEqual([a.name, a.nature, a.type_appro, a.unite], ["Jersey 180", "mp", "negoce", "kg"]);
});

await test("un consommable reçoit son article ; nom, état et unité de l'article font foi", async () => {
  const fam = await one(`select id from consumable_families where code_court='BO'`);
  const c = await one(`insert into consumables(designation, famille_id) values ('Bouton 12', $1) returning id, product_model_id`, [fam.id]);
  const a = await one(`select nature, unite from product_models where id=$1`, [c.product_model_id]);
  assert.deepEqual([a.nature, a.unite], ["consommable", "piece"]);
  await q(`update product_models set name='Bouton nacre 12 mm', active=false, unite='g' where id=$1`, [c.product_model_id]);
  const k = await one(`select designation, actif, unite from consumables where id=$1`, [c.id]);
  assert.deepEqual([k.designation, k.actif, k.unite], ["Bouton nacre 12 mm", false, "g"]);
});

await test("article créé depuis la fiche : sa fiche technique ne recrée pas d'article", async () => {
  const m = await one(`insert into product_models(name, nature, type_appro, unite) values ('Piqué 220','mp','negoce','kg') returning id`);
  const t = await one(`insert into textiles(nom, product_model_id) values ('Piqué 220',$1) returning product_model_id`, [m.id]);
  assert.equal(t.product_model_id, m.id);
  assert.equal((await one(`select count(*)::int n from product_models where name='Piqué 220'`)).n, 1);
  await q(`update product_models set name='Piqué 220 g' where id=$1`, [m.id]);
  assert.equal((await one(`select nom from textiles where product_model_id=$1`, [m.id])).nom, "Piqué 220 g");
});

console.log("Fiche unique : tous les tests passent");
