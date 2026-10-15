// Scénarios SQL (migration 0131) : un changement de statut d'ordre de fabrication alimente la file des notifications.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one } = await setup();
const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const odf = async (ref, company = A) =>
  (await one(`insert into production_orders(reference, company_id, total_quantity) values ($1,$2,50) returning id`, [ref, company])).id;
const statut = (id, s) => q(`update production_orders set status=$2 where id=$1`, [id, s]);
const file = () => q(`select event_key, entity_id, payload from notification_outbox where event_key like 'odf\\_%' order by created_at, id`);

await test("les 6 événements existent, désactivés, sans destinataire (rien ne part sans choix explicite)", async () => {
  const e = await q(`select event_key, enabled, category from notification_events where event_key like 'odf\\_%' order by event_key`);
  assert.deepEqual(e.map((x) => x.event_key), ["odf_annulee", "odf_demande_cloture", "odf_en_attente_validation", "odf_en_production", "odf_refusee", "odf_terminee"]);
  assert.ok(e.every((x) => x.enabled === false && x.category === "commande"));
  assert.equal((await one(`select count(*)::int n from notification_recipients where event_key like 'odf\\_%'`)).n, 0);
});

await test("événement désactivé : le changement de statut ne remplit pas la file", async () => {
  const id = await odf("OF-1");
  await statut(id, "en_production");
  assert.equal((await file()).length, 0);
});

await q(`update notification_events set enabled = true where event_key like 'odf\\_%'`);

await test("événement activé : un changement de statut = un événement, avec l'ancien et le nouveau statut", async () => {
  const id = await odf("OF-2");
  await statut(id, "en_attente_validation");
  await statut(id, "en_production");
  const f = await file();
  assert.deepEqual(f.map((x) => x.event_key), ["odf_en_attente_validation", "odf_en_production"]);
  assert.deepEqual(f[1].payload, { production_order_id: id, ancien_statut: "en_attente_validation", nouveau_statut: "en_production" });
  assert.equal(f[1].entity_id, id);
});

await test("chaque statut cible a son événement ; « brouillon » n'en a pas ; un statut inchangé n'en crée pas", async () => {
  const id = await odf("OF-3");
  const avant = (await file()).length;
  await statut(id, "brouillon");
  await statut(id, "en_production");
  await statut(id, "en_production");
  await statut(id, "demande_cloture");
  await statut(id, "terminee");
  const id2 = await odf("OF-4");
  await statut(id2, "refuse");
  const id3 = await odf("OF-5");
  await statut(id3, "annulee");
  const nouveaux = (await file()).slice(avant).map((x) => x.event_key);
  assert.deepEqual(nouveaux, ["odf_en_production", "odf_demande_cloture", "odf_terminee", "odf_refusee", "odf_annulee"]);
});

await test("la création d'un ordre de fabrication (brouillon) ne notifie rien par ce canal", async () => {
  const avant = (await file()).length;
  await odf("OF-6");
  assert.equal((await file()).length, avant);
});

await test("la file reste fermée aux comptes connectés", async () => {
  const { db } = await setup();
  await db.exec("set role authenticated");
  try {
    await assert.rejects(() => db.query(`select 1 from notification_outbox`), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

console.log("OK");
process.exit(0);
