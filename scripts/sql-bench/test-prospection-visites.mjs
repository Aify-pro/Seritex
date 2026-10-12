// Scénarios SQL (migration 0124) : journal des visites et fiches prospects.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|permission denied/i.test(e.message)) return { ok: false, rows: [] };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}

const u = {};
for (const k of ["administrateur", "direction", "commercial", "infographiste"]) u[k] = await mkUser(k);
u.commercial2 = await mkUser("commercial");

await as(u.administrateur);
const client = await one(`insert into companies(name) values ('Client test') returning id`);

const visite = (uid, auteur, extra = "") =>
  run(uid, `insert into visites(company_id, app_user_id, jour, compte_rendu${extra ? ", nature" : ""}) values ($1, $2, '2026-10-12', 'Échange avec les achats'${extra ? `, '${extra}'` : ""}) returning id`, [client.id, auteur]);

await test("saisie : le commercial saisit ses visites, pas celles d'un collègue ; la direction saisit pour tous", async () => {
  assert.equal((await visite(u.commercial, u.commercial)).ok, true);
  assert.equal((await visite(u.commercial, u.commercial2)).ok, false);
  assert.equal((await visite(u.direction, u.commercial2, "prospection")).ok, true);
  assert.equal((await visite(u.infographiste, u.infographiste)).ok, false);
});

await test("lecture : tout le module Prospection lit le journal (suivi par client) ; hors module, rien", async () => {
  assert.equal((await run(u.commercial2, `select id from visites`)).rows.length, 2);
  assert.equal((await run(u.infographiste, `select id from visites`)).rows.length, 0);
});

await test("correction : chacun corrige les siennes ; la direction corrige tout ; suppression réservée à la direction", async () => {
  assert.equal((await run(u.commercial2, `update visites set resultat = 'x' where app_user_id = $1 returning id`, [u.commercial])).rows.length, 0);
  assert.equal((await run(u.commercial, `update visites set resultat = 'RDV obtenu' where app_user_id = $1 returning id`, [u.commercial])).rows.length, 1);
  assert.equal((await run(u.direction, `update visites set prochaine_action = 'Relancer' returning id`)).rows.length, 2);
  assert.equal((await run(u.commercial, `delete from visites where app_user_id = $1 returning id`, [u.commercial])).rows.length, 0);
  assert.equal((await run(u.direction, `delete from visites where app_user_id = $1 returning id`, [u.commercial2])).rows.length, 1);
});

await test("contraintes : visite à rattacher = libellé obligatoire ; nature, source et clé de reprise contrôlées", async () => {
  await assert.rejects(q(`insert into visites(app_user_id, jour, compte_rendu) values ($1, '2026-10-12', 'x')`, [u.commercial]), /check/);
  const v = await one(`insert into visites(app_user_id, jour, compte_rendu, tiers_libelle, source, ref_externe) values ($1, '2026-10-12', 'x', 'COFINA', 'reprise_excel', 'AMY:62') returning id`, [u.commercial]);
  assert.ok(v.id);
  await assert.rejects(q(`insert into visites(app_user_id, jour, compte_rendu, tiers_libelle, ref_externe) values ($1, '2026-10-12', 'x', 'COFINA', 'AMY:62')`, [u.commercial]), /unique|duplicate/);
  await assert.rejects(q(`insert into visites(company_id, app_user_id, jour, compte_rendu, nature) values ($1, $2, '2026-10-12', 'x', 'dejeuner')`, [client.id, u.commercial]), /check/);
  await assert.rejects(q(`insert into visites(company_id, app_user_id, jour, compte_rendu, source) values ($1, $2, '2026-10-12', 'x', 'sms')`, [client.id, u.commercial]), /check/);
  await assert.rejects(q(`insert into visites(company_id, app_user_id, jour, compte_rendu) values ($1, $2, '2026-10-12', '')`, [client.id, u.commercial]), /check/);
});

await test("fiche client supprimée : ses visites restent, à rattacher sous le nom mémorisé", async () => {
  await as(u.administrateur);
  const c = await one(`insert into companies(name) values ('Éphémère') returning id`);
  await q(`insert into visites(company_id, app_user_id, jour, compte_rendu) values ($1, $2, '2026-10-12', 'x')`, [c.id, u.commercial]);
  await q(`delete from companies where id = $1`, [c.id]);
  assert.equal((await one(`select count(*)::int n from visites where tiers_libelle = 'Éphémère' and company_id is null`)).n, 1);
});

await test("prospects : fiche de ciblage lue par le module, écrite avec create / modify ; notes sur 5", async () => {
  await as(u.administrateur);
  const p = await one(`insert into companies(name, prospection_etape, commercial_attitre_id) values ('Endeavour Mining', 'suspect', $1) returning id`, [u.commercial]);
  assert.equal((await run(u.commercial, `insert into prospects_fiches(company_id, code, axe_offre, taille, zone, note_potentiel) values ($1, 'PSP001', 'tenues_normees', 'grand_compte', 'COCODY', 5) returning code`, [p.id])).ok, true);
  assert.equal((await run(u.infographiste, `select code from prospects_fiches`)).rows.length, 0);
  assert.equal((await run(u.commercial2, `update prospects_fiches set note_recurrence = 4 returning code`)).rows.length, 1);
  await assert.rejects(q(`update prospects_fiches set note_potentiel = 6`), /check/);
  await assert.rejects(q(`update prospects_fiches set axe_offre = 'autre'`), /check/);
  await assert.rejects(q(`update prospects_fiches set code = 'psp 1'`), /check/);
});
