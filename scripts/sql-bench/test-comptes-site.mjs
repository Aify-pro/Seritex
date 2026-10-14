// Scénarios SQL (migration 0125) : compte créé depuis le site, puis rattaché par Seritex (B2B / B2C).
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();

const commercial = await mkUser("commercial");
const livreur = await mkUser("livreur");
const sage = (await one(`insert into companies(name) values ('Société Sage') returning id`)).id;

const mkAuth = async (email) => {
  const id = crypto.randomUUID();
  await q(`insert into auth.users(id,email) values ($1,$2)`, [id, email]);
  return id;
};
const asRole = async (uid, fn) => {
  await as(uid);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
};

const visiteur = await mkAuth("awa.kone@exemple.ci");
await test("création du compte du site : client sans société, origine 'site'", async () => {
  await q(`select create_site_account($1,'  Awa.Kone@Exemple.ci ','Awa Koné','0707070707','Atelier Koné')`, [visiteur]);
  const u = await one(`select role::text, company_id, origine, email, telephone, entreprise_declaree from app_users where id=$1`, [visiteur]);
  assert.deepEqual(u, { role: "client", company_id: null, origine: "site", email: "awa.kone@exemple.ci", telephone: "0707070707", entreprise_declaree: "Atelier Koné" });
});

await test("idempotent : un second appel ne change rien", async () => {
  await q(`select create_site_account($1,'autre@exemple.ci','Autre Nom',null,null)`, [visiteur]);
  assert.equal((await one(`select email from app_users where id=$1`, [visiteur])).email, "awa.kone@exemple.ci");
});

await test("coordonnées invalides refusées", async () => {
  const id = await mkAuth("x@exemple.ci");
  await expectFail(() => q(`select create_site_account($1,'pas-un-mail','Awa',null,null)`, [id]), /coordonnées invalides/);
});

await test("la règle reste stricte pour un compte créé par le personnel : client sans société refusé", async () => {
  const id = await mkAuth("staff@exemple.ci");
  await expectFail(
    () => q(`insert into app_users(id,email,full_name,role,role_id) values ($1,'staff@exemple.ci','X','client',(select id from roles where key='client'))`, [id]),
    /app_users_client_has_company/,
  );
});

await test("l'API publique ne peut pas créer de compte (service_role seul)", async () => {
  const id = await mkAuth("pirate@exemple.ci");
  await db.exec("set role authenticated");
  try {
    await expectFail(() => q(`select create_site_account($1,'pirate@exemple.ci','Pirate',null,null)`, [id]), /permission denied/);
  } finally { await db.exec("reset role"); }
});

await test("liste à rattacher : visible du commercial, refusée au livreur", async () => {
  const l = await asRole(commercial, () => q(`select email from site_accounts_a_rattacher()`));
  assert.deepEqual(l.map((r) => r.email), ["awa.kone@exemple.ci"]);
  await asRole(livreur, () => expectFail(() => q(`select * from site_accounts_a_rattacher()`), /accès refusé/));
});

await test("sans société, le compte du site ne voit aucune société", async () => {
  const n = await asRole(visiteur, async () => (await one(`select count(*)::int n from companies`)).n);
  assert.equal(n, 0);
});

await test("B2B : crée le contact dans la société et lie le compte", async () => {
  await asRole(commercial, () => q(`select attach_site_account_b2b($1,$2)`, [visiteur, sage]));
  const u = await one(`select company_id, contact_id from app_users where id=$1`, [visiteur]);
  assert.equal(u.company_id, sage);
  const c = await one(`select first_name, last_name, email, company_id from contacts where id=$1`, [u.contact_id]);
  assert.deepEqual(c, { first_name: "Awa", last_name: "Koné", email: "awa.kone@exemple.ci", company_id: sage });
  assert.equal((await q(`select 1 from site_accounts_a_rattacher()`)).length, 0);
});

await test("B2B : un compte déjà rattaché ne peut pas l'être deux fois", async () => {
  await asRole(commercial, () => expectFail(() => q(`select attach_site_account_b2b($1,$2)`, [visiteur, sage]), /déjà rattaché/));
});

const particulier = await mkAuth("moussa@exemple.ci");
await q(`select create_site_account($1,'moussa@exemple.ci','Moussa',null,null)`, [particulier]);
await test("B2C : crée une fiche hors Sage (type b2c) avec un seul contact, nom de famille repris si absent", async () => {
  const cid = (await asRole(commercial, () => one(`select attach_site_account_b2c($1) as id`, [particulier]))).id;
  const co = await one(`select name, origin, sage_code, client_type from companies where id=$1`, [cid]);
  assert.deepEqual(co, { name: "Moussa", origin: "manuel", sage_code: null, client_type: "b2c" });
  const contacts = await q(`select first_name, last_name from contacts where company_id=$1`, [cid]);
  assert.deepEqual(contacts, [{ first_name: "Moussa", last_name: "Moussa" }]);
  assert.equal((await one(`select company_id from app_users where id=$1`, [particulier])).company_id, cid);
});

await test("le livreur ne peut rattacher personne", async () => {
  const id = await mkAuth("zoe@exemple.ci");
  await q(`select create_site_account($1,'zoe@exemple.ci','Zoé Diallo',null,null)`, [id]);
  await asRole(livreur, () => expectFail(() => q(`select attach_site_account_b2b($1,$2)`, [id, sage]), /accès refusé/));
  await asRole(livreur, () => expectFail(() => q(`select attach_site_account_b2c($1)`, [id]), /accès refusé/));
});

console.log("OK");
process.exit(0);
