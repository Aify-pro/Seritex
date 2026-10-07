// Scénarios SQL (migration 0113) : livraison pilotée par la matrice.
// 1) mêmes droits qu'avant ; 2) une case cochée / décochée change l'effet ;
// 3) le commercial garde les lieux sans gagner le pilotage des expéditions.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|accès refusé|permission denied/.test(e.message)) return { ok: false, rows: [], msg: e.message };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const can = async (uid, sql, params) => (await run(uid, sql, params)).ok;
const setRight = (roleKey, moduleKey, col, v) =>
  q(`update role_permissions set ${col} = $3 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key=$2)`, [roleKey, moduleKey, v]);

const u = {};
for (const k of ["administrateur", "commercial", "responsable_livraison", "responsable_production", "infographiste", "livreur"]) u[k] = await mkUser(k);
await as(u.administrateur);
const company = (await one(`insert into companies(name) values ('Client livraison') returning id`)).id;

let n = 0;
const newCarrier = () => [`insert into carriers(nom, type) values ($1,'prestataire')`, [`Transporteur ${++n}`]];
const newVehicle = () => [`insert into vehicles(type, libelle) values ('camion', $1)`, [`Camion ${++n}`]];
const newZone = () => [`insert into delivery_zones(nom) values ($1)`, [`Zone ${++n}`]];
const newPlace = () => [`insert into delivery_places(company_id, libelle) values ($1,$2)`, [company, `Lieu ${++n}`]];
// assert_delivery_manager() n'est appelable que par d'autres fonctions (jamais directement par l'API) :
// on l'exécute donc sans changer de rôle, avec l'identité de l'utilisateur.
async function manages(uid) {
  await as(uid);
  try {
    await db.query(`select assert_delivery_manager()`);
    return true;
  } catch (e) {
    if (/accès refusé/.test(e.message)) return false;
    throw e;
  }
}

await test("transporteurs, véhicules, zones : responsable livraison et administrateur (comme avant)", async () => {
  const exp = { administrateur: true, responsable_livraison: true, commercial: false, responsable_production: false, infographiste: false };
  for (const [role, ok] of Object.entries(exp)) {
    assert.equal(await can(u[role], ...newCarrier()), ok, `${role} : transporteur`);
    assert.equal(await can(u[role], ...newVehicle()), ok, `${role} : véhicule`);
    assert.equal(await can(u[role], ...newZone()), ok, `${role} : zone`);
  }
});

await test("lieux de livraison : commercial, responsable livraison et administrateur (comme avant)", async () => {
  const exp = { administrateur: true, responsable_livraison: true, commercial: true, responsable_production: false, infographiste: false, livreur: false };
  for (const [role, ok] of Object.entries(exp)) assert.equal(await can(u[role], ...newPlace()), ok, `${role} : lieu`);
});

await test("suppression d'un transporteur : administrateur seulement (comme avant)", async () => {
  await as(u.administrateur);
  const c = await one(`insert into carriers(nom, type) values ('À supprimer','interne') returning id`);
  assert.equal((await run(u.responsable_livraison, `delete from carriers where id=$1 returning id`, [c.id])).rows.length, 0);
  assert.equal((await run(u.administrateur, `delete from carriers where id=$1 returning id`, [c.id])).rows.length, 1);
});

await test("pilotage des expéditions : responsable livraison et administrateur, PAS le commercial (comme avant)", async () => {
  const exp = { administrateur: true, responsable_livraison: true, commercial: false, responsable_production: false, infographiste: false };
  for (const [role, ok] of Object.entries(exp)) assert.equal(await manages(u[role]), ok, `${role} : piloter`);
});

await test("le commercial n'a plus « livraisons / modifier » mais garde ses lieux", async () => {
  const r = await one(`select rp.can_modify as livraisons, (select rp2.can_modify from role_permissions rp2 join modules m2 on m2.id=rp2.module_id where m2.key='lieux_livraison' and rp2.role_id=rp.role_id) as lieux
    from role_permissions rp join modules m on m.id=rp.module_id where m.key='livraisons' and rp.role_id=(select id from roles where key='commercial')`);
  assert.deepEqual([r.livraisons, r.lieux], [false, true]);
});

await test("MATRICE : « Modifier » sur les livraisons ouvre le pilotage au commercial", async () => {
  await setRight("commercial", "livraisons", "can_modify", true);
  assert.equal(await manages(u.commercial), true);
});

await test("MATRICE : retirer « Modifier » sur les livraisons retire le pilotage au responsable livraison", async () => {
  await setRight("responsable_livraison", "livraisons", "can_modify", false);
  assert.equal(await manages(u.responsable_livraison), false);
  assert.equal(await manages(u.administrateur), true);
});

await test("MATRICE : retirer « Modifier » sur les lieux retire la création au commercial", async () => {
  await setRight("commercial", "lieux_livraison", "can_create", false);
  assert.equal(await can(u.commercial, ...newPlace()), false);
});

await test("MATRICE : « Créer » sur les paramètres de livraison ouvre les transporteurs à la production", async () => {
  assert.equal(await can(u.responsable_production, ...newCarrier()), false);
  await setRight("responsable_production", "parametres_livraison", "can_create", true);
  assert.equal(await can(u.responsable_production, ...newCarrier()), true);
});

console.log("Droits d'écriture livraison par la matrice : tous les tests passent");
