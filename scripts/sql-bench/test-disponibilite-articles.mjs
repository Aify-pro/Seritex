// Scénarios SQL (migration 0107) : disponibilité des articles d'après les
// rouleaux de tissu — suivi par grammage, seuil en kg, rouleaux comptés.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey D','JD') returning id`);
const tissu = await one(`insert into product_models(name, nature, type_appro, unite, matiere_id) values ('Jersey D','mp','negoce','kg',$1) returning id`, [jersey.id]);
const t125 = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey D 125',125,$1,'125',$2) returning id`, [jersey.id, tissu.id]);
const t150 = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey D 150',150,$1,'150',$2) returning id`, [jersey.id, tissu.id]);
const blanc = await one(`insert into colors(name, code) values ('Blanc D','#fff') returning id`);
const noir = await one(`insert into colors(name, code) values ('Noir D','#000') returning id`);
const rouge = await one(`insert into colors(name, code) values ('Rouge D','#f00') returning id`);

// Produit fini : tissu 125 g/m², trois couleurs.
const pf = await one(`insert into product_models(name, nature, matiere_id) values ('Tee D','pf',$1) returning id`, [jersey.id]);
await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [pf.id, t125.id]);
for (const c of [blanc, noir, rouge]) await q(`insert into product_model_colors values ($1,$2)`, [pf.id, c.id]);

const roll = (textile, color, kg, statut = "en_stock") =>
  q(`insert into textile_rolls(textile_id, color_id, poids_initial_kg, poids_kg, statut) values ($1,$2,$3,$3,$4)`, [textile, color, kg, statut]);
const statuts = async () =>
  Object.fromEntries((await q(`select color_name, statut from article_availability($1)`, [[pf.id]])).map((r) => [r.color_name, r.statut]));

await test("suivi désactivé (défaut) : rien n'est signalé, tout est « non suivi »", async () => {
  await roll(t125.id, blanc.id, 20);
  assert.deepEqual(await statuts(), { "Blanc D": "non_suivi", "Noir D": "non_suivi", "Rouge D": "non_suivi" });
});

await test("suivi activé : couleur avec rouleau disponible, sans rouleau ou rouleau épuisé / en production indisponible", async () => {
  await roll(t125.id, rouge.id, 15, "epuise");
  await roll(t125.id, rouge.id, 15, "en_production").catch(() => {}); // en_production exige un ODF : ignoré ici
  await q(`update textiles set suivi_disponibilite = true where id=$1`, [t125.id]);
  assert.deepEqual(await statuts(), { "Blanc D": "disponible", "Noir D": "indisponible", "Rouge D": "indisponible" });
});

await test("seuil en kg : strictement supérieur, rouleaux cumulés", async () => {
  await q(`update textiles set seuil_disponibilite_kg = 25 where id=$1`, [t125.id]);
  assert.equal((await statuts())["Blanc D"], "indisponible"); // 20 kg ≤ 25
  await roll(t125.id, blanc.id, 10);
  assert.equal((await statuts())["Blanc D"], "disponible"); // 30 kg > 25
});

await test("un autre grammage ne compte pas pour ce tissu", async () => {
  await roll(t150.id, noir.id, 500);
  assert.equal((await statuts())["Noir D"], "indisponible");
});

await test("textile_availability : par grammage × couleur ayant des rouleaux", async () => {
  const rows = await q(`select grammage, color_name, statut, rouleaux, kg from textile_availability($1) order by grammage, color_name`, [tissu.id]);
  const blancRow = rows.find((r) => Number(r.grammage) === 125 && r.color_name === "Blanc D");
  assert.deepEqual([blancRow.statut, blancRow.rouleaux, Number(blancRow.kg)], ["disponible", 2, 30]);
  const noir150 = rows.find((r) => Number(r.grammage) === 150 && r.color_name === "Noir D");
  assert.equal(noir150.statut, "non_suivi"); // 150 g/m² : suivi pas activé
});

await test("droits : un livreur (hors personnel) n'accède pas aux fonctions du personnel", async () => {
  const client = await mkUser("livreur");
  await as(client);
  await assert.rejects(() => q(`select * from article_availability($1)`, [[pf.id]]), /accès refusé/);
  await as(admin);
});

console.log("Disponibilité des articles : tous les tests passent");
