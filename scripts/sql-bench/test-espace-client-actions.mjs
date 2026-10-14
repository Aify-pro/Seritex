// Actions engageantes du client depuis le site (www.seritex.ci/espace-client), avec SA session :
// accepter un devis envoyé (accept_quote) et écrire dans le fil d'une demande (messages).
// Aucune migration : ces garanties existent depuis 0002 ; ce test les fige avant de les exposer au public.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const commercial = await mkUser("commercial");
const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const B = (await one(`insert into companies(name) values ('Société B') returning id`)).id;
const clientA = await mkUser("client", { company_id: A });
const clientB = await mkUser("client", { company_id: B });
const orphelin = crypto.randomUUID();
await q(`insert into auth.users(id,email) values ($1,'orphelin@t.ci')`, [orphelin]);
await q(`select create_site_account($1,'orphelin@t.ci','Orphelin Test','0700000000',null)`, [orphelin]);

const req = async (ref, company) => (await one(`insert into requests(reference, company_id, status, description) values ($1,$2,'devis_envoye','d') returning id`, [ref, company])).id;
const rA = await req("DEM-A", A);
const rB = await req("DEM-B", B);
const devis = async (ref, request, company, statut) => {
  const id = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ($1,$2,$3,$4,1000) returning id`, [ref, request, company, statut])).id;
  await q(`insert into quote_lines(quote_id, description, quantity, unit_price) values ($1,'Ligne',10,100)`, [id]);
  return id;
};
const qEnvoye = await devis("DEV-A-ENVOYE", rA, A, "envoye");
const qBrouillon = await devis("DEV-A-BROUILLON", rA, A, "brouillon");
const qB = await devis("DEV-B-ENVOYE", rB, B, "envoye");

async function comme(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

await test("un compte du site non rattaché ne peut accepter aucun devis", async () => {
  await expectFail(() => comme(orphelin, `select accept_quote($1)`, [qEnvoye]), /accès refusé/);
});

await test("un client ne peut pas accepter le devis d'une autre société", async () => {
  await expectFail(() => comme(clientA, `select accept_quote($1)`, [qB]), /accès refusé/);
  assert.equal((await one(`select status::text s from quotes where id=$1`, [qB])).s, "envoye");
  assert.equal((await one(`select count(*)::int n from production_orders where quote_id=$1`, [qB])).n, 0);
});

await test("un client ne peut pas accepter un devis qui n'a pas été envoyé", async () => {
  await expectFail(() => comme(clientA, `select accept_quote($1)`, [qBrouillon]), /pas en attente/);
  assert.equal((await one(`select status::text s from quotes where id=$1`, [qBrouillon])).s, "brouillon");
});

await test("le client accepte SON devis envoyé : devis accepté, demande acceptée, ordre de fabrication créé, tracé", async () => {
  const po = (await comme(clientA, `select accept_quote($1) as id`, [qEnvoye]))[0].id;
  assert.equal((await one(`select status::text s from quotes where id=$1`, [qEnvoye])).s, "accepte");
  assert.equal((await one(`select status::text s from requests where id=$1`, [rA])).s, "acceptee");
  assert.equal((await one(`select count(*)::int n from production_orders where id=$1 and quote_id=$2`, [po, qEnvoye])).n, 1);
  assert.equal((await one(`select count(*)::int n from status_history where entity_id=$1 and to_status='accepte' and changed_by=$2`, [qEnvoye, clientA])).n, 1);
  assert.equal((await one(`select count(*)::int n from audit_log where entity_id=$1 and action='accept_quote' and user_id=$2`, [qEnvoye, clientA])).n, 1);
});

await test("double acceptation (double clic, deux onglets) : refusée, un seul ordre de fabrication", async () => {
  await expectFail(() => comme(clientA, `select accept_quote($1)`, [qEnvoye]), /pas en attente/);
  assert.equal((await one(`select count(*)::int n from production_orders where quote_id=$1`, [qEnvoye])).n, 1);
});

await test("messages : le client écrit dans le fil de SA demande, sous son propre nom", async () => {
  await comme(clientA, `insert into messages(request_id, sender_id, body) values ($1,$2,'Bonjour')`, [rA, clientA]);
  const m = await comme(clientA, `select body, sender_id from messages where request_id=$1`, [rA]);
  assert.deepEqual(m.map((x) => [x.body, x.sender_id]), [["Bonjour", clientA]]);
});

await test("messages : refusé sur la demande d'une autre société, en usurpant un autre expéditeur, ou sans rattachement", async () => {
  await expectFail(() => comme(clientA, `insert into messages(request_id, sender_id, body) values ($1,$2,'x')`, [rB, clientA]), /row-level security/);
  await expectFail(() => comme(clientA, `insert into messages(request_id, sender_id, body) values ($1,$2,'x')`, [rA, commercial]), /row-level security/);
  await expectFail(() => comme(orphelin, `insert into messages(request_id, sender_id, body) values ($1,$2,'x')`, [rA, orphelin]), /row-level security/);
  assert.equal((await one(`select count(*)::int n from messages`)).n, 1);
});

await test("un client ne modifie ni ne supprime aucun message (le leur compris)", async () => {
  const maj = await comme(clientA, `update messages set body='trafiqué' where request_id=$1 returning id`, [rA]);
  assert.equal(maj.length, 0);
  const sup = await comme(clientA, `delete from messages where request_id=$1 returning id`, [rA]);
  assert.equal(sup.length, 0);
  assert.equal((await one(`select body from messages where request_id=$1`, [rA])).body, "Bonjour");
});

await test("un client ne peut pas changer lui-même le statut d'un devis ou d'une demande", async () => {
  const d = await comme(clientB, `update quotes set status='accepte' where id=$1 returning id`, [qB]);
  const r = await comme(clientB, `update requests set status='acceptee' where id=$1 returning id`, [rB]);
  assert.equal(d.length + r.length, 0);
  assert.equal((await one(`select status::text s from quotes where id=$1`, [qB])).s, "envoye");
});

console.log("OK");
process.exit(0);
