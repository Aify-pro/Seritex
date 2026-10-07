// Scénarios SQL (migration 0115) : qui voit les demandes est piloté par la matrice.
// 1) mêmes lecteurs qu'avant ; 2) une case cochée / décochée change ce qu'on voit.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function visible(uid) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(`select reference from requests order by reference`)).rows.map((r) => r.reference);
  } finally {
    await db.exec("reset role");
  }
}
const setRight = (roleKey, moduleKey, col, v) =>
  q(`update role_permissions set ${col} = $3 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key=$2)`, [roleKey, moduleKey, v]);

const u = {};
for (const k of ["administrateur", "commercial", "responsable_production", "infographiste", "gestionnaire_stock", "livreur"]) u[k] = await mkUser(k);
await as(u.administrateur);
const company = (await one(`insert into companies(name) values ('Client demandes') returning id`)).id;
await q(`insert into requests(reference, company_id, needs_graphics) values ('DEM-CLIENT', $1, false)`, [company]);
await q(`insert into requests(reference, company_id, needs_graphics) values ('DEM-VISUEL', $1, true)`, [company]);
await q(`insert into requests(reference, company_id) values ('DEM-STOCK', null)`);
await q(`insert into requests(reference, company_id, source, prospect) values ('DEM-SITE', null, 'site', '{"nom":"Prospect"}'::jsonb)`);

await test("lecteurs d'avant préservés : administrateur et commercial voient tout", async () => {
  for (const role of ["administrateur", "commercial"]) assert.deepEqual(await visible(u[role]), ["DEM-CLIENT", "DEM-SITE", "DEM-STOCK", "DEM-VISUEL"], role);
});

await test("la production ne voit que les demandes pour le stock (comme avant)", async () => {
  assert.deepEqual(await visible(u.responsable_production), ["DEM-STOCK"]);
});

await test("l'infographiste voit les demandes à visuel et celles pour le stock (comme avant)", async () => {
  assert.deepEqual(await visible(u.infographiste), ["DEM-STOCK", "DEM-VISUEL"]);
});

await test("gestionnaire de stock : seulement les demandes pour le stock ; livreur : aucune", async () => {
  assert.deepEqual(await visible(u.gestionnaire_stock), ["DEM-STOCK"]);
  assert.deepEqual(await visible(u.livreur), []);
});

await test("le menu de la production passe par « Demandes pour le stock »", async () => {
  const r = await one(`select
    (select rp.can_view from role_permissions rp join modules m on m.id=rp.module_id where m.key='demandes' and rp.role_id=r.id) as demandes,
    (select rp.can_view from role_permissions rp join modules m on m.id=rp.module_id where m.key='demandes_stock' and rp.role_id=r.id) as stock
    from roles r where r.key='responsable_production'`);
  assert.deepEqual([r.demandes, r.stock], [false, true]);
});

await test("MATRICE : « Voir » sur Demandes ouvre toutes les demandes à la production", async () => {
  await setRight("responsable_production", "demandes", "can_view", true);
  assert.deepEqual(await visible(u.responsable_production), ["DEM-CLIENT", "DEM-SITE", "DEM-STOCK", "DEM-VISUEL"]);
});

await test("MATRICE : retirer « Voir » sur Demandes au commercial ne lui laisse que les demandes pour le stock", async () => {
  await setRight("commercial", "demandes", "can_view", false);
  assert.deepEqual(await visible(u.commercial), ["DEM-STOCK"]);
});

await test("MATRICE : « Voir » sur Demandes graphiques ouvre les demandes à visuel au gestionnaire", async () => {
  await setRight("gestionnaire_stock", "demandes_graphiques", "can_view", true);
  assert.deepEqual(await visible(u.gestionnaire_stock), ["DEM-STOCK", "DEM-VISUEL"]);
});

console.log("Lecture des demandes par la matrice : tous les tests passent");
