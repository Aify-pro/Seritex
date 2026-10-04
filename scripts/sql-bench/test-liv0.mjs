// Scénarios SQL du lot LIV-0 (migrations 0074-0075) : rôles livraison,
// cloisonnement du livreur, lieux géolocalisés.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;

const admin = await mkUser("administrateur");
const livreur = await mkUser("livreur");
const commercial = await mkUser("commercial");
const company = (await one(`insert into companies(name) values ('Client livré') returning id`)).id;

/** Exécute en tant qu'utilisateur authentifié (RLS appliquée). */
async function asAuth(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

await test("zones pré-remplies : 13 communes + Intérieur + International", async () => {
  const z = await one(`select count(*)::int n, count(*) filter (where type='commune')::int c from delivery_zones`);
  assert.deepEqual([z.n, z.c], [15, 13]);
});

await test("transporteur « Flotte Seritex » ; Yango/DHL ne peuvent pas être actifs", async () => {
  assert.ok(await one(`select 1 from carriers where nom='Flotte Seritex' and type='interne'`));
  await expectFail(() => q(`insert into carriers(nom,type,integration) values ('Yango','prestataire','yango')`), /carriers_integration_v1/);
  await q(`insert into carriers(nom,type,integration,actif) values ('Yango','prestataire','yango',false)`);
});

let lieuA, lieuB;
await test("plusieurs lieux par client, un seul par défaut", async () => {
  [lieuA] = await asAuth(commercial, `insert into delivery_places(company_id, libelle, par_defaut) values ($1,'Siège',true) returning id`, [company]);
  [lieuB] = await asAuth(commercial, `insert into delivery_places(company_id, libelle) values ($1,'Entrepôt Yopougon') returning id`, [company]);
  await expectFail(() => q(`update delivery_places set par_defaut=true where id=$1`, [lieuB.id]), /un_defaut_par_client/);
  await asAuth(commercial, `select set_default_delivery_place($1)`, [lieuB.id]);
  const d = await q(`select id from delivery_places where company_id=$1 and par_defaut`, [company]);
  assert.deepEqual(d.map((r) => r.id), [lieuB.id]);
});

await test("coordonnées et origine de la position enregistrées", async () => {
  await asAuth(commercial, `select record_delivery_place_position($1, 5.3364, -4.0267, 'carte', false)`, [lieuA.id]);
  const p = await one(`select latitude, longitude, position_source, position_confirmee_at from delivery_places where id=$1`, [lieuA.id]);
  assert.deepEqual([Number(p.latitude), Number(p.longitude), p.position_source, p.position_confirmee_at], [5.3364, -4.0267, "carte", null]);
  await expectFail(() => q(`update delivery_places set longitude=null where id=$1`, [lieuA.id]), /position_complete|source_si_position/);
});

await test("le livreur n'accède à rien d'autre (RLS)", async () => {
  assert.equal((await asAuth(livreur, `select count(*)::int n from companies`))[0].n, 0);
  assert.equal((await asAuth(livreur, `select count(*)::int n from delivery_places`))[0].n, 0);
  assert.equal((await asAuth(livreur, `select count(*)::int n from production_orders`))[0].n, 0);
  assert.equal((await asAuth(livreur, `select count(*)::int n from sections`))[0].n, 0);
  assert.equal((await asAuth(livreur, `select count(*)::int n from app_users`))[0].n, 1);
  assert.equal((await asAuth(commercial, `select count(*)::int n from companies`))[0].n, 1);
  await expectFail(() => asAuth(livreur, `select record_delivery_place_position($1, 5.3, -4.0)`, [lieuA.id]), /ne fait pas partie/);
  await expectFail(() => asAuth(livreur, `insert into delivery_places(company_id, libelle) values ($1,'X')`, [company]), /row-level security/);
});

await test("is_staff exclut le livreur, pas le responsable livraison", async () => {
  const rl = await mkUser("responsable_livraison");
  assert.equal((await asAuth(rl, `select is_staff() s`))[0].s, true);
  assert.equal((await asAuth(livreur, `select is_staff() s`))[0].s, false);
  assert.equal((await asAuth(admin, `select is_staff() s`))[0].s, true);
});
console.log("LIV-0 : tous les tests passent");
