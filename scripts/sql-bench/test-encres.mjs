// Scénarios SQL (migration 0116) : nuancier d'encres de la séparation des couleurs.
// 1) lecture par tout le personnel ; 2) écriture selon la matrice (module « encres ») ;
// 3) contraintes (couleur #RRGGBB, nom unique sans tenir compte de la casse).
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|permission denied/i.test(e.message)) return { ok: false, rows: [], msg: e.message };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const can = async (uid, sql, params) => (await run(uid, sql, params)).ok;
const seen = async (uid, sql, params) => (await run(uid, sql, params)).rows.length;
const setRight = (roleKey, col, v) =>
  q(`update role_permissions set ${col} = $2 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key='encres')`, [roleKey, v]);

const u = {};
for (const k of ["administrateur", "responsable_production", "infographiste", "commercial", "livreur"]) u[k] = await mkUser(k);

let n = 0;
const nouvelle = () => [`insert into encres(nom, hex) values ($1, '#D62828')`, [`Encre ${++n}`]];

await test("création : administrateur et production ; ni infographiste ni commercial", async () => {
  const exp = { administrateur: true, responsable_production: true, infographiste: false, commercial: false };
  for (const [role, ok] of Object.entries(exp)) assert.equal(await can(u[role], ...nouvelle()), ok, `${role} : création`);
});

await test("lecture : tout le personnel (l'outil de séparation en a besoin), pas le livreur", async () => {
  for (const role of ["administrateur", "responsable_production", "infographiste", "commercial"]) {
    assert.ok((await seen(u[role], `select id from encres`)) >= 2, `${role} : lecture`);
  }
  assert.equal(await seen(u.livreur, `select id from encres`), 0, "livreur : rien");
});

await test("modification et suppression : selon la matrice", async () => {
  assert.equal(await seen(u.infographiste, `update encres set gamme = 'plastisol' returning id`), 0, "infographiste : aucune ligne modifiée");
  assert.ok((await seen(u.responsable_production, `update encres set gamme = 'plastisol' returning id`)) >= 2);
  assert.equal(await seen(u.commercial, `delete from encres returning id`), 0, "commercial : rien supprimé");
});

await test("MATRICE : « Créer » coché ouvre la création à l'infographiste, décoché la retire à la production", async () => {
  await setRight("infographiste", "can_create", true);
  assert.equal(await can(u.infographiste, ...nouvelle()), true);
  await setRight("responsable_production", "can_create", false);
  assert.equal(await can(u.responsable_production, ...nouvelle()), false);
});

await test("contraintes : couleur au format #RRGGBB majuscules, nom unique quelle que soit la casse", async () => {
  await as(u.administrateur);
  await assert.rejects(q(`insert into encres(nom, hex) values ('Mauvais', '#d62828')`), /check/);
  await assert.rejects(q(`insert into encres(nom, hex) values ('Mauvais', 'rouge')`), /check/);
  await q(`insert into encres(nom, hex, sous_couche) values ('Blanc couvrant', '#FFFFFF', true)`);
  await assert.rejects(q(`insert into encres(nom, hex) values (' blanc COUVRANT ', '#FFFFFE')`), /unique|duplicate/);
});
