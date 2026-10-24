// Scénarios SQL des semi-finis, étape 1 (migration 0143) : nature semi_fini
// (code SF, jamais Sage ni e-shop, sans déclinaison), patrons rattachés aux
// semi-finis, nomenclature du produit fini avec lignes semi-finis par zone et
// couleur imposée.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
// Patron de produit fini créé avant 0143 (comme TS-M01 en production).
const old = await one(`insert into product_models(name, nature) values ('T-shirt ancien','pf') returning id`);
await q(`alter table pattern_articles disable trigger pattern_articles_semi_fini`);
await q(`insert into pattern_articles(article_code, designation, product_model_id) values ('TS-M01','ancien',$1)`, [old.id]);
await q(`alter table pattern_articles enable trigger pattern_articles_semi_fini`);
const admin = await mkUser("administrateur");
await as(admin);

let manche, pf, col, bouton;
await test("semi-fini : code SF001/SF002 sans catégorie, jamais Sage ni e-shop, pas de déclinaison", async () => {
  manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning *`);
  col = await one(`insert into product_models(name, nature) values ('Col V','semi_fini') returning *`);
  assert.deepEqual([manche.code, col.code, manche.categorie_id], ["SF001", "SF002", null]);
  await expectFail(() => q(`update product_models set code='X' where id=$1`, [manche.id]), /fig/);
  await expectFail(() => q(`update product_models set sage_reference='X' where id=$1`, [manche.id]), /semi_fini_interne/);
  await expectFail(() => q(`update product_models set publiable_eshop=true where id=$1`, [manche.id]), /semi_fini_interne/);
  await expectFail(() => q(`insert into product_variants(model_id, color_id, code) values ($1,(select id from colors limit 1),'Z')`, [manche.id]), /pas de déclinaison/);
});
await test("patron : sur un semi-fini seulement, un seul ; l'ancien patron de PF reste modifiable", async () => {
  await q(`insert into pattern_articles(article_code, designation, product_model_id) values ('SF-MAN','Manche',$1)`, [manche.id]);
  await expectFail(() => q(`insert into pattern_articles(article_code, designation, product_model_id) values ('SF-MAN2','Manche',$1)`, [manche.id]), /déjà un patron/);
  await expectFail(() => q(`insert into pattern_articles(article_code, designation, product_model_id) values ('TS2','x',$1)`, [old.id]), /semi-fini/);
  await q(`update pattern_articles set designation='ancien modifié' where article_code='TS-M01'`);
  const pa = await one(`select id from pattern_articles where article_code='TS-M01'`);
  await q(`insert into patterns(article_id, size) values ($1,'Homme/M')`, [pa.id]);
});
await test("nomenclature : semi-finis par zone, entiers ; couleur imposée aussi sur un consommable ; natures contrôlées", async () => {
  pf = await one(`insert into product_models(name, nature) values ('T-shirt col V','pf') returning id`);
  await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'manche_gauche','Manche gauche'),($1,'manche_droite','Manche droite'),($1,'col','Col')`, [pf.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'manche_gauche'),($1,'',1,'',$2,'manche_droite')`, [pf.id, manche.id]);
  const l = await one(`select designation, unite from nomenclature_lines where product_model_id=$1 limit 1`, [pf.id]);
  assert.deepEqual([l.designation, l.unite], ["Manche courte", "piece"]);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'manche_gauche')`, [pf.id, manche.id]), /duplicate|unique/);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',1.5,'',$2)`, [pf.id, col.id]), /entier/);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'inconnue')`, [pf.id, col.id]), /zone_fk/);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',1,'',$1)`, [pf.id]), /nature semi-fini/);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite) values ($1,'Fil',1,'m')`, [manche.id]), /seul un produit fini/);
  const fam = await one(`select id from consumable_families where code_court='BO'`);
  bouton = await one(`insert into consumables(designation, famille_id) values ('Bouton',$1) returning id`, [fam.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, consumable_id, couleur_imposee_id) values ($1,'Bouton',3,'piece',$2,(select id from colors limit 1))`, [pf.id, bouton.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'col')`, [pf.id, col.id]);
  await q(`delete from product_zone_templates where product_model_id=$1 and zone_key='col'`, [pf.id]);
  const c = await one(`select zone_key, product_model_id from nomenclature_lines where semi_fini_id=$1`, [col.id]);
  assert.equal(c.zone_key, null); assert.equal(c.product_model_id, pf.id);
});

console.log("Semi-finis : tous les tests passent");
