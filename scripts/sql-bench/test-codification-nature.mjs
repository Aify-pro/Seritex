// Scénarios SQL de la codification par nature (migration 0102) : une règle
// par nature, tissu décliné en grammages × couleurs, consommable en
// dimensions × couleurs, axes contrôlés, plusieurs grammages par tissu.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
await as(admin);

await test("trois règles de codification ; segments contrôlés par nature", async () => {
  const rules = await q(`select nature, segments from coding_rules order by nature`);
  assert.deepEqual(rules.map((r) => [r.nature, r.segments]), [
    ["consommable", ["modele", "couleur", "dimension"]],
    ["mp", ["matiere", "grammage", "couleur"]],
    ["pf", ["modele", "matiere", "grammage", "couleur", "taille"]],
  ]);
  await expectFail(() => q(`update coding_rules set segments = array['taille','couleur'] where nature='mp'`), /segments_valides/);
  await expectFail(() => q(`update coding_rules set segments = array['couleur'] where nature='consommable'`), /segments_valides/);
});

const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const blanc = await one(`insert into colors(name, code) values ('Blanc N','#fff') returning id`);
await q(`update colors set code_court='BLX' where id=$1`, [blanc.id]);
const noir = await one(`insert into colors(name, code) values ('Noir N','#000') returning id`);
await q(`update colors set code_court='NOX' where id=$1`, [noir.id]);

let tissu;
await test("tissu « Jersey » : deux grammages, grammage × couleur → JE180BLX", async () => {
  tissu = await one(`insert into product_models(name, nature, type_appro, unite, matiere_id) values ('Jersey','mp','negoce','kg',$1) returning id`, [jersey.id]);
  await q(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey',160,$1,'160',$2)`, [jersey.id, tissu.id]);
  await q(`select add_textile_grammage($1, 180)`, [tissu.id]);
  await expectFail(() => q(`select add_textile_grammage($1, 180)`, [tissu.id]), /existe déjà/);
  const noms = (await q(`select nom from textiles where product_model_id=$1 order by grammage`, [tissu.id])).map((r) => r.nom);
  assert.deepEqual(noms, ["Jersey 160 g", "Jersey 180 g"]);
  await expectFail(() => q(`select ensure_variants($1)`, [tissu.id]), /aucune couleur/);
  await q(`insert into product_model_colors values ($1,$2),($1,$3)`, [tissu.id, blanc.id, noir.id]);
  assert.equal((await one(`select ensure_variants($1) n`, [tissu.id])).n, 4);
  const codes = (await q(`select code from product_variants where model_id=$1 order by code`, [tissu.id])).map((r) => r.code);
  assert.deepEqual(codes, ["JE160BLX", "JE160NOX", "JE180BLX", "JE180NOX"]);
  // Couleur retirée : déclinaisons désactivées, jamais supprimées.
  await q(`delete from product_model_colors where product_model_id=$1 and color_id=$2`, [tissu.id, noir.id]);
  await q(`select ensure_variants($1)`, [tissu.id]);
  assert.equal((await one(`select count(*)::int n from product_variants where model_id=$1 and actif`, [tissu.id])).n, 2);
  // Renommer l'article renomme ses grammages.
  await q(`update product_models set name='Jersey coton' where id=$1`, [tissu.id]);
  assert.deepEqual((await q(`select nom from textiles where product_model_id=$1 order by grammage`, [tissu.id])).map((r) => r.nom), ["Jersey coton 160 g", "Jersey coton 180 g"]);
});

await test("consommable : dimensions × couleurs, axes facultatifs → COBO0001BLX12", async () => {
  const fam = await one(`select id from consumable_families where code_court='BO'`);
  const c = await one(`insert into consumables(designation, famille_id) values ('Bouton nacre',$1) returning product_model_id`, [fam.id]);
  const art = c.product_model_id;
  await expectFail(() => q(`select ensure_variants($1)`, [art]), /couleurs et\/ou des dimensions/);
  await q(`insert into article_dimensions(product_model_id, libelle, code_court) values ($1,'12 mm','12'),($1,'15 mm','15')`, [art]);
  assert.equal((await one(`select ensure_variants($1) n`, [art])).n, 2); // dimensions seules
  await q(`insert into product_model_colors values ($1,$2)`, [art, blanc.id]);
  await q(`select ensure_variants($1)`, [art]);
  const actives = (await q(`select code from product_variants where model_id=$1 and actif order by code`, [art])).map((r) => r.code);
  assert.deepEqual(actives, ["COBO0001BLX12", "COBO0001BLX15"]); // sans couleur → désactivées
  await expectFail(() => q(`insert into product_variants(model_id, code) values ($1,'X1')`, [art]), /couleur et\/ou une dimension/);
});

await test("axes contrôlés : un produit fini garde grammage × couleur × taille ; vue du stock avec plusieurs grammages", async () => {
  const pf = await one(`insert into product_models(name) values ('T-shirt N') returning id`);
  await expectFail(() => q(`insert into product_variants(model_id, color_id, code) values ($1,$2,'X2')`, [pf.id, blanc.id]), /produit fini/);
  await expectFail(() => q(`select add_textile_grammage($1, 200)`, [pf.id]), /article tissu/);
  const row = await one(`select textile_id from stock_articles_overview() where product_model_id=$1`, [tissu.id]);
  assert.ok(row.textile_id);
  await as(commercial);
  await expectFail(() => q(`select add_textile_grammage($1, 200)`, [tissu.id]), /accès refusé/);
});

console.log("Codification par nature : tous les tests passent");
