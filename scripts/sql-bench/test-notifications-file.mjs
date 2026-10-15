// Scénarios SQL (migration 0129) : destinataires de notification configurables + file d'attente
// alimentée par la base (devis accepté, message d'un client).
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const clientA = await mkUser("client", { company_id: A });

async function comme(role, uid, fn) {
  await as(uid);
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const outbox = () => q(`select event_key, entity_type, payload from notification_outbox order by created_at, id`);

const rq = (await one(`insert into requests(reference, company_id, status, description) values ('DEM-A',$1,'devis_envoye','d') returning id`, [A])).id;
const devis = async (ref) => {
  const id = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ($1,$2,$3,'envoye',1000) returning id`, [ref, rq, A])).id;
  await q(`insert into quote_lines(quote_id, description, quantity, unit_price) values ($1,'L',10,100)`, [id]);
  return id;
};

await test("réglages d'origine : devis accepté → rôle Direction, message client → responsable du dossier", async () => {
  const r = await q(`select event_key, kind, role_key from notification_recipients order by event_key`);
  assert.deepEqual(r, [
    { event_key: "devis_accepte", kind: "role", role_key: "direction" },
    { event_key: "message_client", kind: "responsable_dossier", role_key: null },
  ]);
  assert.equal((await one(`select count(*)::int n from notification_events where event_key='message_client'`)).n, 1);
});

await test("devis accepté (par le client, avec sa session) : UN événement dans la file, une seule fois", async () => {
  const d = await devis("DEV-1");
  await comme("authenticated", clientA, () => q(`select accept_quote($1)`, [d]));
  const f = await outbox();
  assert.equal(f.length, 1);
  assert.equal(f[0].event_key, "devis_accepte");
  assert.equal(f[0].payload.quote_id, d);
  await comme("authenticated", clientA, () => expectFail(() => q(`select accept_quote($1)`, [d]), /pas en attente/));
  assert.equal((await outbox()).length, 1, "pas de doublon");
});

await test("message d'un client : événement ; message du personnel : aucun", async () => {
  await comme("authenticated", clientA, () => q(`insert into messages(request_id, sender_id, body) values ($1,$2,'Bonjour')`, [rq, clientA]));
  await comme("authenticated", commercial, () => q(`insert into messages(request_id, sender_id, body) values ($1,$2,'Réponse')`, [rq, commercial]));
  const f = (await outbox()).filter((x) => x.event_key === "message_client");
  assert.equal(f.length, 1);
  assert.equal(f[0].entity_id === undefined, true);
  assert.equal((await one(`select entity_id from notification_outbox where event_key='message_client'`)).entity_id, rq);
});

await test("la file et ses fonctions sont inaccessibles aux comptes connectés", async () => {
  for (const [role, uid] of [["authenticated", clientA], ["authenticated", commercial], ["authenticated", admin], ["anon", null]]) {
    await comme(role, uid, () => expectFail(() => q(`select * from notification_outbox`), /permission denied/));
    await comme(role, uid, () => expectFail(() => q(`select * from claim_notification_outbox(10)`), /permission denied/));
  }
});

await test("réservation : service_role prend les lignes à traiter, pas deux fois, avec délai croissant", async () => {
  const premiere = await comme("service_role", null, () => q(`select id, attempts from claim_notification_outbox(10)`));
  assert.equal(premiere.length, 2);
  assert.ok(premiere.every((r) => r.attempts === 1));
  const seconde = await comme("service_role", null, () => q(`select id from claim_notification_outbox(10)`));
  assert.equal(seconde.length, 0, "déjà réservées");
  await q(`update notification_outbox set process_after = now() - interval '1 second'`);
  const reprise = await comme("service_role", null, () => q(`select attempts from claim_notification_outbox(10)`));
  assert.ok(reprise.every((r) => r.attempts === 2));
  const delai = (await one(`select min(extract(epoch from process_after - now()))::int s from notification_outbox`)).s;
  assert.ok(delai > 200 && delai <= 240, `délai ${delai}s attendu ~4 min`);
});

await test("une ligne traitée ou abandonnée (6 tentatives) n'est plus réservée", async () => {
  await q(`update notification_outbox set process_after = now() - interval '1 second', processed_at = now() where event_key='devis_accepte'`);
  await q(`update notification_outbox set process_after = now() - interval '1 second', attempts = 6 where event_key='message_client'`);
  assert.equal((await comme("service_role", null, () => q(`select id from claim_notification_outbox(10)`))).length, 0);
});

await test("destinataires : l'administrateur de la plateforme les gère, personne d'autre", async () => {
  await comme("authenticated", admin, () => q(`insert into notification_recipients(event_key, kind, user_id) values ('devis_accepte','user',$1)`, [commercial]));
  assert.equal((await one(`select count(*)::int n from notification_recipients where event_key='devis_accepte'`)).n, 2);
  for (const uid of [commercial, clientA]) {
    const vus = await comme("authenticated", uid, () => q(`select id from notification_recipients`));
    assert.equal(vus.length, 0, "réglage invisible");
    await comme("authenticated", uid, () => expectFail(() => q(`insert into notification_recipients(event_key, kind) values ('devis_accepte','contact_client')`), /row-level security/));
  }
});

await test("destinataires : cible cohérente avec le type, pas de doublon, événement connu", async () => {
  await expectFail(() => q(`insert into notification_recipients(event_key, kind) values ('devis_accepte','user')`), /notification_recipients_cible/);
  await expectFail(() => q(`insert into notification_recipients(event_key, kind, user_id, role_key) values ('devis_accepte','role',$1,'direction')`, [commercial]), /notification_recipients_cible|violates/);
  await expectFail(() => q(`insert into notification_recipients(event_key, kind, user_id) values ('devis_accepte','user',$1)`, [commercial]), /duplicate key/);
  await expectFail(() => q(`insert into notification_recipients(event_key, kind) values ('inconnu','contact_client')`), /foreign key/);
  await expectFail(() => q(`insert into notification_recipients(event_key, kind) values ('message_client','responsable_dossier')`), /duplicate key/);
});

await test("un destinataire supprimé avec son compte ou son événement disparaît de la liste", async () => {
  await q(`delete from notification_recipients where user_id=$1`, [commercial]);
  assert.equal((await one(`select count(*)::int n from notification_recipients where event_key='devis_accepte'`)).n, 1);
});

console.log("OK");
process.exit(0);
