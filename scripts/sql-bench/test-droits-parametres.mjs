// Scénarios SQL (migration 0114) : écrans de Paramètres pilotés par la matrice.
// 1) mêmes droits qu'avant ; 2) une case cochée / décochée change l'effet.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|accès refusé|permission denied|non autorisée|réservée aux rôles/i.test(e.message)) return { ok: false, rows: [], msg: e.message };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const can = async (uid, sql, params) => (await run(uid, sql, params)).ok;
const seen = async (uid, sql, params) => (await run(uid, sql, params)).rows.length;
const setRight = (roleKey, moduleKey, col, v) =>
  q(`update role_permissions set ${col} = $3 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key=$2)`, [roleKey, moduleKey, v]);

const u = {};
for (const k of ["administrateur", "commercial", "responsable_production", "infographiste", "gestionnaire_stock"]) u[k] = await mkUser(k);
await as(u.administrateur);
await q(`insert into audit_log(action, entity_type) values ('test','test')`);

let n = 0;
const newColor = () => [`insert into colors(name, code) values ($1,$2)`, [`Couleur ${++n}`, `#C${n}`]];
const newSection = () => [`insert into sections(name) values ($1)`, [`Section ${++n}`]];
const newRule = () => [`insert into dispatch_rules(groupe) values ($1)`, [`Groupe ${++n}`]];
const touchPricing = [`update pricing_settings set updated_at = now() returning id`, []];
const readAudit = [`select id from audit_log`, []];

await test("couleurs : production et administrateur (comme avant)", async () => {
  const exp = { administrateur: true, responsable_production: true, commercial: false, infographiste: false, gestionnaire_stock: false };
  for (const [role, ok] of Object.entries(exp)) assert.equal(await can(u[role], ...newColor()), ok, `${role} : couleur`);
});

await test("sections, dispatching, réglages de tarification : administrateur seulement (comme avant)", async () => {
  for (const [role, ok] of Object.entries({ administrateur: true, responsable_production: false, commercial: false })) {
    assert.equal(await can(u[role], ...newSection()), ok, `${role} : section`);
    assert.equal(await can(u[role], ...newRule()), ok, `${role} : règle de dispatching`);
    assert.equal((await seen(u[role], ...touchPricing)) > 0, ok, `${role} : réglages de tarification`);
  }
});

await test("journal d'audit : administrateur seulement (comme avant)", async () => {
  assert.ok((await seen(u.administrateur, ...readAudit)) >= 1);
  assert.equal(await seen(u.responsable_production, ...readAudit), 0);
  assert.equal(await seen(u.commercial, ...readAudit), 0);
});

await test("suppression d'une couleur : administrateur seulement (comme avant)", async () => {
  await as(u.administrateur);
  const c = await one(`insert into colors(name, code) values ('À supprimer','#D00') returning id`);
  assert.equal((await run(u.responsable_production, `select delete_color($1)`, [c.id])).ok, false);
  assert.equal((await run(u.administrateur, `select delete_color($1)`, [c.id])).ok, true);
});

await test("numérotation des devis : commercial et administrateur (comme avant)", async () => {
  assert.equal((await run(u.commercial, `select next_document_number('DEV')`)).ok, true);
  assert.equal((await run(u.administrateur, `select next_document_number('DEV')`)).ok, true);
  assert.equal((await run(u.responsable_production, `select next_document_number('DEV')`)).ok, false);
});

await test("MATRICE : « Créer » sur Couleurs et tailles ouvre la création à l'infographiste", async () => {
  assert.equal(await can(u.infographiste, ...newColor()), false);
  await setRight("infographiste", "couleurs_tailles", "can_create", true);
  assert.equal(await can(u.infographiste, ...newColor()), true);
});

await test("MATRICE : retirer « Créer » sur Couleurs et tailles retire la création à la production", async () => {
  await setRight("responsable_production", "couleurs_tailles", "can_create", false);
  assert.equal(await can(u.responsable_production, ...newColor()), false);
});

await test("MATRICE : « Voir » sur le journal d'audit l'ouvre à la production", async () => {
  await setRight("responsable_production", "audit", "can_view", true);
  assert.ok((await seen(u.responsable_production, ...readAudit)) >= 1);
});

await test("MATRICE : « Créer » sur Sections ouvre la création à la production", async () => {
  await setRight("responsable_production", "sections", "can_create", true);
  assert.equal(await can(u.responsable_production, ...newSection()), true);
});

await test("MATRICE : « Créer » sur les devis retire / donne la numérotation", async () => {
  await setRight("commercial", "devis", "can_create", false);
  assert.equal((await run(u.commercial, `select next_document_number('DEV')`)).ok, false);
});

console.log("Droits d'écriture paramètres par la matrice : tous les tests passent");
