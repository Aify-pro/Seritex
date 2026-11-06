// Scénarios SQL (migration 0157) : Paramètres > Personnel.
// 1) les salaires ne sont lisibles que par le droit « Personnel » ;
// 2) un employé confidentiel ne peut porter aucun montant ;
// 3) matricule unique (sans casse), paie au 1er du mois, répartition par section.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|violates|permission denied|accès refusé/i.test(e.message)) return { ok: false, rows: [], msg: e.message };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}

const u = {};
for (const k of ["administrateur", "commercial", "responsable_production"]) u[k] = await mkUser(k);

await as(u.administrateur);
const coupe = await one(`insert into sections(name) values ('Coupe test') returning id`);
const fin = await one(`insert into sections(name) values ('Finition test') returning id`);

await test("administrateur crée une fiche ; les autres rôles ne la voient pas ni ne l'écrivent", async () => {
  const ins = await run(u.administrateur, `insert into employes(matricule, nom, salaire_base) values ('M001','Awa',100000) returning id`);
  assert.equal(ins.ok, true);
  assert.equal((await run(u.administrateur, `select id from employes`)).rows.length, 1);
  for (const role of ["commercial", "responsable_production"]) {
    assert.equal((await run(u[role], `select id from employes`)).rows.length, 0, `${role} : lecture des salaires`);
    assert.equal((await run(u[role], `insert into employes(matricule, nom) values ('X','X')`)).ok, false, `${role} : écriture`);
    assert.equal((await run(u[role], `select * from paies_mensuelles`)).rows.length, 0, `${role} : paie`);
    assert.equal((await run(u[role], `select * from imports_personnel`)).rows.length, 0, `${role} : imports`);
  }
});

await test("matricule unique sans tenir compte de la casse ni des espaces", async () => {
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom) values (' m001 ','Doublon')`)).ok, false);
});

await test("employé confidentiel : aucun montant possible", async () => {
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, confidentiel, salaire_base) values ('D001','DG',true,500000)`)).ok, false);
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, confidentiel) values ('D001','DG',true)`)).ok, true);
  assert.equal((await run(u.administrateur, `update employes set salaire_base = 1 where matricule='D001'`)).ok, false);
});

await test("répartition par section : pourcentage de 0 à 100, une ligne par section", async () => {
  const e = await one(`select id from employes where matricule='M001'`);
  assert.equal((await run(u.administrateur, `insert into employes_sections values ($1,$2,60),($1,$3,40)`, [e.id, coupe.id, fin.id])).ok, true);
  assert.equal((await run(u.administrateur, `select employes_sections_total($1) as t`, [e.id])).rows[0].t, "100.00");
  assert.equal((await run(u.administrateur, `insert into employes_sections values ($1,$2,0)`, [e.id, coupe.id])).ok, false);
  assert.equal((await run(u.administrateur, `insert into employes_sections values ($1,$2,50)`, [e.id, coupe.id])).ok, false, "même section deux fois");
});

await test("paie : le mois est le 1er du mois, une ligne par employé et par mois", async () => {
  const e = await one(`select id from employes where matricule='M001'`);
  assert.equal((await run(u.administrateur, `insert into paies_mensuelles(employe_id, mois, salaire_base) values ($1,'2026-10-15',1)`, [e.id])).ok, false);
  assert.equal((await run(u.administrateur, `insert into paies_mensuelles(employe_id, mois, salaire_base) values ($1,'2026-10-01',100000)`, [e.id])).ok, true);
  assert.equal((await run(u.administrateur, `insert into paies_mensuelles(employe_id, mois, salaire_base) values ($1,'2026-10-01',1)`, [e.id])).ok, false);
});

await test("présence : statut connu, heures de 0 à 24", async () => {
  const e = await one(`select id from employes where matricule='M001'`);
  assert.equal((await run(u.administrateur, `insert into presences_employes values ($1,'2026-10-01','present',8)`, [e.id])).ok, true);
  assert.equal((await run(u.administrateur, `insert into presences_employes values ($1,'2026-10-02','vacances',8)`, [e.id])).ok, false);
  assert.equal((await run(u.administrateur, `insert into presences_employes values ($1,'2026-10-03','present',30)`, [e.id])).ok, false);
});

await test("supprimer une fiche supprime sa paie, sa présence et ses sections", async () => {
  assert.equal((await run(u.administrateur, `delete from employes where matricule='M001'`)).ok, true);
  assert.equal((await run(u.administrateur, `select * from paies_mensuelles`)).rows.length, 0);
  assert.equal((await run(u.administrateur, `select * from presences_employes`)).rows.length, 0);
  assert.equal((await run(u.administrateur, `select * from employes_sections`)).rows.length, 0);
});

console.log("test-personnel : OK");
