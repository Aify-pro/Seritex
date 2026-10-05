// Scénarios SQL des demandes du site web (migration 0094) : création par la
// clé service_role du site, reconnaissance d'un client existant, demande sans
// client (prospect) visible des seuls commerciaux, rattachement au client, et
// séparation avec les demandes pour le stock.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;

async function asRole(role, uid, sql, params) {
  await as(uid);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const site = (payload) => asRole("service_role", null, `select create_site_request($1::jsonb) r`, [JSON.stringify(payload)]).then((r) => r[0].r);

const commercial = await mkUser("commercial");
const prod = await mkUser("responsable_production");
const connu = (await one(`insert into companies(name, email) values ('Client connu', 'achats@connu.ci') returning id`)).id;
const contact = (await one(`insert into contacts(company_id, first_name, last_name, email) values ($1,'Awa','Koné','Awa@Connu.ci') returning id`, [connu])).id;

const base = { nom: "Jean Prospect", entreprise: "Nouvelle SARL", telephone: "0700000000", produit_libelle: "Polos", quantite: "120", technique_libelle: "Broderie" };

let web;
await test("prospect inconnu : demande WEB-AAAA-NNNN sans client, coordonnées conservées", async () => {
  web = await site({ ...base, email: "jean@nouvelle.ci", message: "Logo cœur" });
  assert.match(web.reference, /^WEB-\d{4}-0001$/);
  assert.equal(web.client_reconnu, false);
  const r = await one(`select company_id, source, status, prospect, description from requests where id=$1`, [web.id]);
  assert.equal(r.company_id, null);
  assert.equal(r.source, "site");
  assert.equal(r.status, "nouvelle");
  assert.equal(r.prospect.email, "jean@nouvelle.ci");
  assert.match(r.description, /Polos[\s\S]*Logo cœur/);
});

await test("client connu par l'e-mail d'un contact (casse ignorée) : demande rattachée au client et au contact", async () => {
  const r = await site({ ...base, email: "awa@connu.ci" });
  assert.equal(r.client_reconnu, true);
  const row = await one(`select company_id, contact_id from requests where id=$1`, [r.id]);
  assert.deepEqual([row.company_id, row.contact_id], [connu, contact]);
});

await test("client connu par l'e-mail de la fiche client", async () => {
  const r = await site({ ...base, email: "ACHATS@connu.ci" });
  assert.equal((await one(`select company_id from requests where id=$1`, [r.id])).company_id, connu);
});

await test("e-mail présent sur deux clients : pas de rattachement automatique", async () => {
  const autre = (await one(`insert into companies(name) values ('Autre') returning id`)).id;
  await q(`insert into contacts(company_id, first_name, last_name, email) values ($1,'A','B','double@x.ci'),($2,'C','D','double@x.ci')`, [connu, autre]);
  const r = await site({ ...base, email: "double@x.ci" });
  assert.equal(r.client_reconnu, false);
});

await test("seule la clé service_role du site peut créer une demande du site", async () => {
  await expectFail(() => asRole("authenticated", commercial, `select create_site_request('{}'::jsonb)`), /permission denied/);
  await expectFail(() => asRole("anon", null, `select create_site_request('{}'::jsonb)`), /permission denied/);
  await expectFail(() => site({ nom: "", email: "x@y.ci" }), /incomplète/);
});

await test("anti-abus : 5 demandes par e-mail et par heure", async () => {
  for (let i = 0; i < 5; i++) await site({ ...base, email: "spam@x.ci" });
  await expectFail(() => site({ ...base, email: "spam@x.ci" }), /trop de demandes/);
});

await test("demande du site sans client : visible des commerciaux, pas de la production", async () => {
  const vueCo = await asRole("authenticated", commercial, `select id from requests where id=$1`, [web.id]);
  const vueProd = await asRole("authenticated", prod, `select id from requests where id=$1`, [web.id]);
  assert.equal(vueCo.length, 1);
  assert.equal(vueProd.length, 0);
});

await test("demande pour le stock : toujours visible de la production", async () => {
  await as(prod);
  const stock = (await one(`insert into requests(reference, company_id, description, source) values ('STK-1', null, 'stock', 'manuel') returning id`)).id;
  const vueProd = await asRole("authenticated", prod, `select id from requests where id=$1`, [stock]);
  assert.equal(vueProd.length, 1);
});

await test("rattachement : le commercial pose le client, la demande devient une demande client", async () => {
  const nouveau = (await one(`insert into companies(name) values ('Nouvelle SARL (créée dans Sage)') returning id`)).id;
  await asRole("authenticated", commercial, `update requests set company_id=$2 where id=$1`, [web.id, nouveau]);
  const r = await one(`select company_id, prospect from requests where id=$1`, [web.id]);
  assert.equal(r.company_id, nouveau);
  assert.equal(r.prospect.nom, "Jean Prospect");
  await expectFail(() => asRole("authenticated", prod, `update requests set prospect=null where id=$1 returning id`, [web.id]).then((rows) => { if (!rows.length) throw new Error("refusé"); }), /refusé/);
});

await test("une demande hors site ne peut pas porter de coordonnées de prospect", async () => {
  await expectFail(() => q(`insert into requests(reference, source, prospect) values ('X-1','manuel','{}'::jsonb)`), /requests_prospect_site/);
});
