// Scénarios SQL (migration 0109) : écritures du domaine commercial pilotées par
// la matrice. 1) aucun rôle ne perd un droit qu'il avait ; 2) cocher / décocher
// une case change réellement ce que le rôle peut faire.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

// Exécute une écriture sous RLS en tant qu'utilisateur ; true = acceptée.
async function can(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    await db.query(sql, params);
    return true;
  } catch (e) {
    if (/row-level security|accès refusé|permission denied/.test(e.message)) return false;
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
async function count(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return Number((await db.query(sql, params)).rows[0].n);
  } finally {
    await db.exec("reset role");
  }
}

const u = {};
for (const k of ["administrateur", "commercial", "responsable_production", "infographiste", "gestionnaire_stock", "comptabilite"]) u[k] = await mkUser(k);
await q(`insert into roles(key,label,base_role,is_system,active) values ('direction_t','Direction T','administrateur',false,true) returning id`);
u.direction_t = await mkUser("direction_t");
// Un rôle créé après la migration reçoit ses lignes à la création (createRole) : on les recopie de l'administrateur.
await q(`insert into role_permissions(role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
  select (select id from roles where key='direction_t'), module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock
  from role_permissions where role_id=(select id from roles where key='administrateur')`);
await as(u.administrateur);
const co = await one(`insert into companies(name) values ('ACME') returning id`);
const rq = await one(`insert into requests(reference, company_id, status) values ('DEM-T1',$1,'nouvelle') returning id`, [co.id]);

const newCompany = (name) => [`insert into companies(name) values ($1)`, [name]];
const newQuote = (ref) => [`insert into quotes(reference, request_id, company_id) values ($1,$2,$3)`, [ref, rq.id, co.id]];
const newRequest = (ref) => [`insert into requests(reference, company_id) values ($1,$2)`, [ref, co.id]];
const newStockRequest = (ref) => [`insert into requests(reference, company_id) values ($1, null)`, [ref]];
let nSample = 0;
const newSample = () => [`insert into sample_requests(reference, company_id, request_id, need_description) values ($1,$2,$3,'besoin')`, [`ECH-T${++nSample}`, co.id, rq.id]];

await test("droits d'avant préservés : qui peut créer un client, un devis, une demande, un échantillon", async () => {
  const expect = {
    administrateur: [true, true, true, true],
    direction_t: [true, true, true, true],
    commercial: [true, true, true, true],
    responsable_production: [false, false, false, false],
    infographiste: [false, false, false, false],
    gestionnaire_stock: [false, false, false, false],
    comptabilite: [false, false, false, false],
  };
  let i = 0;
  for (const [role, [client, devis, demande, echantillon]] of Object.entries(expect)) {
    i += 1;
    assert.equal(await can(u[role], ...newCompany(`C${i}`)), client, `${role} : créer un client`);
    assert.equal(await can(u[role], ...newQuote(`DV-${i}`)), devis, `${role} : créer un devis`);
    assert.equal(await can(u[role], ...newRequest(`DM-${i}`)), demande, `${role} : créer une demande client`);
    assert.equal(await can(u[role], ...newSample()), echantillon, `${role} : créer un échantillon`);
  }
});

await test("demande pour le stock : commercial, production et direction (comme avant)", async () => {
  let i = 0;
  for (const [role, ok] of Object.entries({ administrateur: true, commercial: true, responsable_production: true, infographiste: false, comptabilite: false })) {
    i += 1;
    assert.equal(await can(u[role], ...newStockRequest(`ST-${i}`)), ok, `${role} : demande stock`);
  }
});

await test("suppression d'un client : base administrateur seulement (comme avant)", async () => {
  await as(u.administrateur);
  const a = await one(`insert into companies(name) values ('À supprimer 1') returning id`);
  const b = await one(`insert into companies(name) values ('À supprimer 2') returning id`);
  assert.equal(await count(u.commercial, `with d as (delete from companies where id=$1 returning 1) select count(*) n from d`, [a.id]), 0);
  assert.equal(await count(u.administrateur, `with d as (delete from companies where id=$1 returning 1) select count(*) n from d`, [b.id]), 1);
});

await test("la production garde la modification d'un échantillon, mais pas sa création", async () => {
  await as(u.administrateur);
  const s = await one(`insert into sample_requests(reference, company_id, request_id, need_description) values ('ECH-TX',$1,$2,'besoin') returning id`, [co.id, rq.id]);
  assert.equal(await count(u.responsable_production, `with x as (update sample_requests set updated_at = now() where id=$1 returning 1) select count(*) n from x`, [s.id]), 1);
  assert.equal(await count(u.infographiste, `with x as (update sample_requests set updated_at = now() where id=$1 returning 1) select count(*) n from x`, [s.id]), 0);
});

await test("lecture des devis : commercial et administrateur voient, la production non (comme avant)", async () => {
  await as(u.administrateur);
  await q(...newQuote("DV-LECT"));
  assert.ok((await count(u.commercial, `select count(*) n from quotes`)) >= 1);
  assert.equal(await count(u.responsable_production, `select count(*) n from quotes`), 0);
});

await test("MATRICE : cocher « Créer » sur Clients pour l'infographiste lui ouvre la création", async () => {
  assert.equal(await can(u.infographiste, ...newCompany("Via matrice")), false);
  await q(`update role_permissions set can_create = true where role_id=(select id from roles where key='infographiste') and module_id=(select id from modules where key='clients')`);
  assert.equal(await can(u.infographiste, ...newCompany("Via matrice")), true);
});

await test("MATRICE : décocher « Créer » sur Devis retire la création au commercial", async () => {
  assert.equal(await can(u.commercial, ...newQuote("DV-M1")), true);
  await q(`update role_permissions set can_create = false where role_id=(select id from roles where key='commercial') and module_id=(select id from modules where key='devis')`);
  assert.equal(await can(u.commercial, ...newQuote("DV-M2")), false);
});

await test("MATRICE : « Voir » sur Devis ouvre la lecture à la production", async () => {
  await q(`update role_permissions set can_view = true where role_id=(select id from roles where key='responsable_production') and module_id=(select id from modules where key='devis')`);
  assert.ok((await count(u.responsable_production, `select count(*) n from quotes`)) >= 1);
});

console.log("Droits d'écriture commercial par la matrice : tous les tests passent");
