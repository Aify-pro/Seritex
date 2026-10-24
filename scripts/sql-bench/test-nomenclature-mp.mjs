// Scénarios SQL des lignes matière première de la nomenclature (migration
// 0144) : bord-côte du col en kg par pièce, exclusif des autres cibles,
// couleur comme les autres lignes, nature contrôlée.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

await test("ligne MP : bord-côte en kg, désignation et unité de l'article, couleur par zone ou imposée", async () => {
  const pf = await one(`insert into product_models(name, nature) values ('Polo','pf') returning id`);
  const bc = await one(`insert into product_models(name, nature, type_appro, unite) values ('Bord-côte','mp','negoce','kg') returning id`);
  const col = await one(`insert into product_models(name, nature) values ('Col polo','semi_fini') returning id`);
  await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'col','Col'),($1,'corps','Corps')`, [pf.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, mp_id, zone_key) values ($1,'',0.012,'',$2,'col')`, [pf.id, bc.id]);
  const l = await one(`select designation, unite, quantite_par_piece from nomenclature_lines where mp_id=$1`, [bc.id]);
  assert.deepEqual([l.designation, l.unite, Number(l.quantite_par_piece)], ["Bord-côte", "kg", 0.012]);
  // Même matière, autre zone : une autre ligne ; même zone : refusée.
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, mp_id, couleur_imposee_id) values ($1,'',0.01,'',$2,(select id from colors limit 1))`, [pf.id, bc.id]);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, mp_id, zone_key) values ($1,'',0.01,'',$2,'col')`, [pf.id, bc.id]), /duplicate|unique/);
  // Une seule cible par ligne ; la cible doit être une matière première.
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, mp_id, semi_fini_id) values ($1,'',1,'',$2,$3)`, [pf.id, bc.id, col.id]), /une_cible/);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, mp_id) values ($1,'',1,'',$2)`, [pf.id, col.id]), /matière première/);
  // Les lignes semi-finis (0143) fonctionnent toujours.
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'col')`, [pf.id, col.id]);
  assert.equal((await one(`select designation from nomenclature_lines where semi_fini_id=$1`, [col.id])).designation, "Col polo");
});

console.log("Nomenclature MP : tous les tests passent");
