// Scénarios SQL (migration 0118) : recettes de réglages de la séparation.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, as, mkUser } = await setup();

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
for (const k of ["administrateur", "infographiste", "commercial", "gestionnaire_stock", "livreur"]) u[k] = await mkUser(k);
const nouvelle = (nom) => [`insert into separation_recettes(nom, reglages) values ($1, '{"rendu":{"type":"aplat"}}') returning id`, [nom]];

await test("création : qui a accès à la séparation (Demandes graphiques), pas les autres", async () => {
  assert.equal((await run(u.infographiste, ...nouvelle("Photo noir"))).ok, true);
  assert.equal((await run(u.administrateur, ...nouvelle("Logo 43T"))).ok, true);
  assert.equal((await run(u.gestionnaire_stock, ...nouvelle("Stock"))).ok, false);
});

await test("lecture : tout le personnel, pas le livreur", async () => {
  assert.equal((await run(u.commercial, `select id from separation_recettes`)).rows.length, 2);
  assert.equal((await run(u.livreur, `select id from separation_recettes`)).rows.length, 0);
});

await test("modification et suppression : l'auteur ou l'administrateur", async () => {
  assert.equal((await run(u.commercial, `update separation_recettes set nom = nom || '!' returning id`)).rows.length, 0);
  assert.equal((await run(u.infographiste, `update separation_recettes set nom = 'Photo sur noir' where nom = 'Photo noir' returning id`)).rows.length, 1);
  assert.equal((await run(u.infographiste, `delete from separation_recettes where nom = 'Logo 43T' returning id`)).rows.length, 0);
  assert.equal((await run(u.administrateur, `delete from separation_recettes where nom = 'Logo 43T' returning id`)).rows.length, 1);
});

await test("contraintes : nom unique quelle que soit la casse, réglages en objet", async () => {
  await as(u.administrateur);
  await assert.rejects(q(`insert into separation_recettes(nom, reglages, created_by) values (' photo SUR noir ', '{}', $1)`, [u.administrateur]), /unique|duplicate/);
  await assert.rejects(q(`insert into separation_recettes(nom, reglages, created_by) values ('Liste', '[]', $1)`, [u.administrateur]), /check/);
});
