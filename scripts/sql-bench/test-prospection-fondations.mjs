// Scénarios SQL (migration 0122) : prospection — commerciaux, réglages, absences, journée due.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|permission denied|Accès refusé/i.test(e.message)) return { ok: false, rows: [] };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const setRight = (roleKey, moduleKey, col, v) =>
  q(`update role_permissions set ${col} = $3 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key=$2)`, [roleKey, moduleKey, v]);

const u = {};
for (const k of ["administrateur", "direction", "commercial", "infographiste", "livreur"]) u[k] = await mkUser(k);
u.commercial2 = await mkUser("commercial");

// Dates de référence : lundi 2026-10-12 … dimanche 2026-10-18.
const LUNDI = "2026-10-12";
const MARDI = "2026-10-13";
const SAMEDI = "2026-10-17";
const DIMANCHE = "2026-10-18";

await test("paramètres : administrateur et direction créent les fiches commerciaux ; pas le commercial", async () => {
  assert.equal((await run(u.commercial, `insert into commerciaux(app_user_id) values ($1) returning id`, [u.commercial])).ok, false);
  const r = await run(u.direction, `insert into commerciaux(app_user_id, whatsapp, email_pro) values ($1, '+2250700000001', 'ali@seritex.ci'), ($2, null, null), ($3, null, null) returning id`, [u.commercial, u.commercial2, u.direction]);
  assert.equal(r.ok, true);
  assert.equal((await run(u.administrateur, `update prospection_reglages set heure_alerte = '07:30' returning id`)).rows.length, 1);
  assert.equal((await run(u.commercial, `update prospection_reglages set heure_alerte = '09:00' returning id`)).rows.length, 0);
});

await test("lecture des référentiels : personnel oui, livreur non", async () => {
  assert.equal((await run(u.infographiste, `select id from commerciaux`)).rows.length, 3);
  assert.equal((await run(u.commercial, `select canal from prospection_canaux`)).rows.length, 4);
  assert.equal((await run(u.livreur, `select id from commerciaux`)).rows.length, 0);
});

await test("contraintes : numéro WhatsApp E.164 unique, e-mail unique sans casse, types de jour", async () => {
  await as(u.administrateur);
  const x = await mkUser("commercial");
  await assert.rejects(q(`insert into commerciaux(app_user_id, whatsapp) values ($1, '0700000001')`, [x]), /check/);
  await assert.rejects(q(`insert into commerciaux(app_user_id, whatsapp) values ($1, '+2250700000001')`, [x]), /unique|duplicate/);
  await assert.rejects(q(`insert into commerciaux(app_user_id, email_pro) values ($1, 'ALI@seritex.ci')`, [x]), /unique|duplicate/);
  await assert.rejects(q(`update prospection_reglages set types_jour = array['visites']`), /check/);
  await assert.rejects(q(`update prospection_reglages set types_jour = array['visites','visites','visites','visites','visites','visites','ferie']`), /check/);
});

await test("absences : le commercial déclare pour lui seul, en « demandée », et ne voit pas celles des autres", async () => {
  assert.equal((await run(u.commercial, `insert into absences_commerciaux(app_user_id, debut, fin, motif) values ($1, $2, $2, 'maladie') returning id`, [u.commercial, MARDI])).ok, true);
  assert.equal((await run(u.commercial, `insert into absences_commerciaux(app_user_id, debut, fin, motif, statut) values ($1, $2, $2, 'conge', 'validee') returning id`, [u.commercial, LUNDI])).ok, false);
  assert.equal((await run(u.commercial, `insert into absences_commerciaux(app_user_id, debut, fin, motif) values ($1, $2, $2, 'conge') returning id`, [u.commercial2, LUNDI])).ok, false);
  assert.equal((await run(u.commercial2, `select id from absences_commerciaux`)).rows.length, 0);
  const a = (await run(u.commercial, `select declaree_par from absences_commerciaux`)).rows[0];
  assert.equal(a.declaree_par, u.commercial);
});

await test("absences : le commercial ne s'auto-valide pas ; la direction valide (trace posée par la base)", async () => {
  assert.equal((await run(u.commercial, `update absences_commerciaux set statut = 'validee' returning id`)).ok, false);
  const r = await run(u.direction, `update absences_commerciaux set statut = 'validee' returning traitee_par, traitee_le`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].traitee_par, u.direction);
  assert.ok(r.rows[0].traitee_le);
  // Validée : le commercial ne peut plus la modifier ni la retirer.
  assert.equal((await run(u.commercial, `update absences_commerciaux set commentaire = 'x' returning id`)).rows.length, 0);
  assert.equal((await run(u.commercial, `delete from absences_commerciaux returning id`)).rows.length, 0);
});

await test("journée due : jours de visites, réunion du samedi, repos, férié, absence validée, direction", async () => {
  await as(u.administrateur);
  await q(`insert into jours_feries(jour, libelle) values ('2026-10-14', 'Test férié')`);
  const statut = async (uid, jour, asUid = uid) => (await run(asUid, `select prospection_statut_journee($1, $2) s`, [uid, jour])).rows[0]?.s;
  assert.equal(await statut(u.commercial, LUNDI), "due");
  assert.equal(await statut(u.commercial, MARDI), "absence");
  assert.equal(await statut(u.commercial, "2026-10-14"), "ferie");
  assert.equal(await statut(u.commercial, SAMEDI), "reunion");
  assert.equal(await statut(u.commercial, DIMANCHE), "repos");
  assert.equal(await statut(u.direction, LUNDI), "direction");
  assert.equal(await statut(u.infographiste, LUNDI), "hors_prospection");
});

await test("journée due : une absence seulement demandée ou refusée ne dispense pas", async () => {
  await as(u.commercial2);
  await run(u.commercial2, `insert into absences_commerciaux(app_user_id, debut, fin, motif) values ($1, $2, $2, 'permission')`, [u.commercial2, LUNDI]);
  assert.equal((await run(u.commercial2, `select prospection_statut_journee($1, $2) s`, [u.commercial2, LUNDI])).rows[0].s, "due");
  await run(u.direction, `update absences_commerciaux set statut = 'refusee', motif_refus = 'Visite client prévue' where app_user_id = $1`, [u.commercial2]);
  assert.equal((await run(u.commercial2, `select prospection_statut_journee($1, $2) s`, [u.commercial2, LUNDI])).rows[0].s, "due");
});

await test("journée due : un commercial ne lit pas le statut d'un collègue ; la direction lit tout", async () => {
  assert.equal((await run(u.commercial2, `select prospection_statut_journee($1, $2) s`, [u.commercial, LUNDI])).ok, false);
  assert.equal((await run(u.direction, `select prospection_statut_journee($1, $2) s`, [u.commercial, LUNDI])).rows[0].s, "due");
});

await test("réglage : samedi passé en jour de visites → journée due ; commercial non soumis → dispensé", async () => {
  await run(u.administrateur, `update prospection_reglages set types_jour[6] = 'visites'`);
  assert.equal((await run(u.commercial, `select prospection_statut_journee($1, $2) s`, [u.commercial, SAMEDI])).rows[0].s, "due");
  await run(u.administrateur, `update commerciaux set soumis_obligation = false where app_user_id = $1`, [u.commercial]);
  assert.equal((await run(u.commercial, `select prospection_statut_journee($1, $2) s`, [u.commercial, SAMEDI])).rows[0].s, "non_soumis");
});

await test("MATRICE : « Valider » coché ouvre la validation des absences à un rôle commercial", async () => {
  const a = await one(`insert into absences_commerciaux(app_user_id, debut, fin, motif) values ($1, $2, $2, 'mission') returning id`, [u.commercial2, SAMEDI]);
  assert.equal((await run(u.commercial, `update absences_commerciaux set statut = 'validee' where id = $1 returning id`, [a.id])).rows.length, 0);
  await setRight("commercial", "prospection", "can_validate", true);
  assert.equal((await run(u.commercial, `update absences_commerciaux set statut = 'validee' where id = $1 returning id`, [a.id])).rows.length, 1);
  await setRight("commercial", "prospection", "can_validate", false);
});

await test("fiche client : étape de prospection contrôlée", async () => {
  await as(u.administrateur);
  await assert.rejects(q(`insert into companies(name, prospection_etape) values ('X', 'chaud')`), /check/);
  const c = await one(`insert into companies(name, prospection_etape, commercial_attitre_id) values ('Prospect test', 'prospect', $1) returning id`, [u.commercial]);
  assert.ok(c.id);
});
