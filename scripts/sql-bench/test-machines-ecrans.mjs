// Scénarios SQL (migration 0119) : machines et écrans de sérigraphie.
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
const setRight = (roleKey, col, v) =>
  q(`update role_permissions set ${col} = $2 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key='machines_ecrans')`, [roleKey, v]);

const u = {};
const section = await one(`select id from sections order by display_order limit 1`);
for (const k of ["administrateur", "responsable_production", "infographiste", "chef_section", "commercial", "livreur"]) {
  u[k] = await mkUser(k, k === "chef_section" ? { section_id: section.id } : {});
}
let n = 0;
const machine = () => [`insert into machines(nom, nb_tetes, cadence_pieces_h) values ($1, 6, 120) returning id`, [`Carrousel ${++n}`]];
const ecran = () => [`insert into ecrans_cadres(code, largeur_cm, hauteur_cm, maillage) values ($1, 50, 60, 77) returning id`, [`E${++n}`]];

await test("création : administrateur et production ; ni infographiste, ni chef de section, ni commercial", async () => {
  for (const [role, ok] of Object.entries({ administrateur: true, responsable_production: true, infographiste: false, chef_section: false, commercial: false })) {
    assert.equal((await run(u[role], ...machine())).ok, ok, `${role} : machine`);
    assert.equal((await run(u[role], ...ecran())).ok, ok, `${role} : écran`);
  }
});

await test("lecture : tout le personnel (outil de séparation), pas le livreur", async () => {
  for (const role of ["infographiste", "commercial", "chef_section"]) {
    assert.equal((await run(u[role], `select id from machines`)).rows.length, 2, `${role} : machines`);
    assert.equal((await run(u[role], `select id from ecrans_cadres`)).rows.length, 2, `${role} : écrans`);
  }
  assert.equal((await run(u.livreur, `select id from machines`)).rows.length, 0);
});

await test("coût horaire : Direction seulement (droits Tarification)", async () => {
  await as(u.administrateur);
  const m = await one(`select id from machines limit 1`);
  assert.equal((await run(u.administrateur, `insert into machine_couts(machine_id, cout_horaire) values ($1, 6000) returning machine_id`, [m.id])).ok, true);
  for (const role of ["responsable_production", "infographiste", "commercial"]) {
    assert.equal((await run(u[role], `select * from machine_couts`)).rows.length, 0, `${role} : lecture du coût`);
  }
});

await test("MATRICE : « Modifier » coché ouvre la mise à jour de l'état d'un écran au chef de section", async () => {
  assert.equal((await run(u.chef_section, `update ecrans_cadres set etat = 'insole' returning id`)).rows.length, 0);
  await setRight("chef_section", "can_modify", true);
  assert.equal((await run(u.chef_section, `update ecrans_cadres set etat = 'insole', travail = 'OF-12 · rouge' returning id`)).rows.length, 2);
});

await test("contraintes : état, maillage, code unique, têtes", async () => {
  await as(u.administrateur);
  await assert.rejects(q(`insert into ecrans_cadres(code, largeur_cm, hauteur_cm, maillage, etat) values ('X1', 50, 60, 77, 'perdu')`), /check/);
  await assert.rejects(q(`insert into ecrans_cadres(code, largeur_cm, hauteur_cm, maillage) values ('X2', 50, 60, 500)`), /check/);
  await q(`insert into ecrans_cadres(code, largeur_cm, hauteur_cm, maillage) values ('A-01', 50, 60, 43)`);
  await assert.rejects(q(`insert into ecrans_cadres(code, largeur_cm, hauteur_cm, maillage) values (' a-01 ', 50, 60, 43)`), /unique|duplicate/);
  await assert.rejects(q(`insert into machines(nom, nb_tetes) values ('Trop', 0)`), /check/);
});
