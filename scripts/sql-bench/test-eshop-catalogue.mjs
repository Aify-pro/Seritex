// Scénarios SQL (migration 0108) : catalogue du site (e-shop, lot E0) — seuls
// les modèles publiables, statuts de couleur alignés sur l'onglet Médias,
// aucun prix ni stock exposé, exécutable par service_role seulement.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

async function asRole(role, sql, params) {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const catalogue = async () => (await asRole("service_role", `select eshop_catalogue() c`))[0].c;

const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey E','JE') returning id`);
const tissu = await one(`insert into product_models(name, nature, type_appro, unite, matiere_id) values ('Jersey E','mp','negoce','kg',$1) returning id`, [jersey.id]);
const t150 = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey E 150',150,$1,'150',$2) returning id`, [jersey.id, tissu.id]);
const t180 = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey E 180',180,$1,'180',$2) returning id`, [jersey.id, tissu.id]);
const blanc = await one(`insert into colors(name, code, hex) values ('Blanc E','BE','#FFFFFF') returning id`);
const noir = await one(`insert into colors(name, code, hex) values ('Noir E','NE','#000000') returning id`);
const rouge = await one(`insert into colors(name, code) values ('Rouge E','RE') returning id`);

const tee = await one(`insert into product_models(name, code, nature, matiere_id, base_price, texte_commercial) values ('Tee E','TEEE','pf',$1,2500,'Le classique') returning id`, [jersey.id]);
for (const t of [t150, t180]) await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [tee.id, t.id]);
for (const c of [blanc, noir, rouge]) await q(`insert into product_model_colors values ($1,$2)`, [tee.id, c.id]);
const sizeM = await one(`select id from sizes where active order by display_order limit 1`);
if (sizeM) await q(`insert into product_model_sizes values ($1,$2)`, [tee.id, sizeM.id]);
await q(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'coeur','Cœur',1),($1,'dos','Dos',2)`, [tee.id]);
await q(`insert into product_model_media(product_model_id, color_id, path, file_name, principale) values ($1,$2,$3,'face.jpg',true)`, [tee.id, blanc.id, `modeles/${tee.id}/face.jpg`]);

// Modèles jamais publiés : non publiable, inactif, matière première.
await one(`insert into product_models(name, nature) values ('Polo caché','pf') returning id`);
await one(`insert into product_models(name, nature, publiable_eshop, active) values ('Ancien','pf',true,false) returning id`);
await one(`insert into product_models(name, nature, type_appro, unite, publiable_eshop) values ('Fil','mp','negoce','kg',true) returning id`);

const roll = (textile, color, kg) =>
  q(`insert into textile_rolls(textile_id, color_id, poids_initial_kg, poids_kg, statut) values ($1,$2,$3,$3,'en_stock')`, [textile, color, kg]);

// E-shop activé dans Paramètres > Site web (0110) : sinon le catalogue est toujours vide.
await q(`update site_settings set eshop_actif = true`);

await test("rien n'est publié tant que « publiable sur l'e-shop » n'est pas coché", async () => {
  assert.deepEqual(await catalogue(), []);
});

await test("seul le produit fini actif et publiable apparaît, sans prix ni stock", async () => {
  await q(`update product_models set publiable_eshop = true where id = $1`, [tee.id]);
  const cat = await catalogue();
  assert.equal(cat.length, 1);
  const m = cat[0];
  assert.equal(m.nom, "Tee E");
  assert.equal(m.code, "TEEE");
  assert.equal(m.texte_commercial, "Le classique");
  assert.deepEqual(m.grammages.map((g) => Number(g.grammage)), [150, 180]);
  assert.deepEqual(m.emplacements.map((z) => z.cle), ["coeur", "dos"]);
  assert.equal(m.medias[0].path, `modeles/${tee.id}/face.jpg`);
  assert.equal(m.tailles.length, sizeM ? 1 : 0);
  const json = JSON.stringify(cat);
  assert.doesNotMatch(json, /2500|base_price|prix|kg|rouleaux/);
});

await test("suivi désactivé : toutes les couleurs « non suivi », modèle proposé", async () => {
  const m = (await catalogue())[0];
  assert.equal(m.statut, "non_suivi");
  assert.deepEqual(Object.fromEntries(m.couleurs.map((c) => [c.nom, c.statut])), { "Blanc E": "non_suivi", "Noir E": "non_suivi", "Rouge E": "non_suivi" });
  assert.equal(m.couleurs.find((c) => c.nom === "Blanc E").hex, "#FFFFFF");
});

await test("un grammage suivi, l'autre non : une couleur n'est indisponible que si tout manque", async () => {
  await q(`update textiles set suivi_disponibilite = true where id = $1`, [t150.id]);
  await roll(t150.id, blanc.id, 20);
  const m = (await catalogue())[0];
  assert.deepEqual(Object.fromEntries(m.couleurs.map((c) => [c.nom, c.statut])), { "Blanc E": "disponible", "Noir E": "non_suivi", "Rouge E": "non_suivi" });
  const d = m.disponibilites.find((x) => x.textile_id === t150.id && x.color_id === noir.id);
  assert.equal(d.statut, "indisponible");
});

await test("tous les grammages suivis : couleurs sans rouleau indisponibles, modèle « partiel »", async () => {
  await q(`update textiles set suivi_disponibilite = true where id = $1`, [t180.id]);
  await roll(t180.id, noir.id, 5);
  const m = (await catalogue())[0];
  assert.deepEqual(Object.fromEntries(m.couleurs.map((c) => [c.nom, c.statut])), { "Blanc E": "disponible", "Noir E": "disponible", "Rouge E": "indisponible" });
  assert.equal(m.statut, "partiel");
});

await test("plus aucun rouleau : modèle indisponible (le site affiche la mention)", async () => {
  await q(`update textile_rolls set statut = 'epuise', poids_kg = 0`);
  const m = (await catalogue())[0];
  assert.equal(m.statut, "indisponible");
});

await test("réservé au serveur du site : refusé aux rôles anon et authenticated", async () => {
  await expectFail(() => asRole("anon", `select eshop_catalogue()`), /permission denied/);
  await expectFail(() => asRole("authenticated", `select eshop_catalogue()`), /permission denied/);
});
