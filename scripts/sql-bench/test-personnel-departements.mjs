// Scénarios SQL (migration 0160) : départements de la paie Sage.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, db } = await setup();

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
for (const k of ["administrateur", "commercial"]) u[k] = await mkUser(k);
await as(u.administrateur);

await test("les 40 départements du tableau Sage sont chargés ; direction et commercial sont de la structure", async () => {
  const r = (await run(u.administrateur, `select code, libelle, structure, section_id from departements order by code`)).rows;
  assert.equal(r.length, 40);
  const par = Object.fromEntries(r.map((x) => [x.code, x]));
  assert.equal(par["001"].libelle, "Confection");
  assert.equal(par["002"].libelle, "Sérigraphie");
  assert.equal(par["022"].structure, true);
  assert.equal(par["032"].structure, true);
  assert.equal(par["005"].structure, false, "les autres restent à classer");
});

await test("un département est une section OU de la structure, jamais les deux", async () => {
  const s = await one(`insert into sections(name) values ('Section dep') returning id`);
  assert.equal((await run(u.administrateur, `update departements set section_id=$1 where code='005'`, [s.id])).ok, true);
  assert.equal((await run(u.administrateur, `update departements set section_id=$1 where code='022'`, [s.id])).ok, false);
});

await test("un département de même nom qu'une section est rattaché automatiquement", async () => {
  const r = (await run(u.administrateur, `select section_id from departements where code='005'`)).rows[0];
  assert.ok(r.section_id, "posé par le test précédent");
});

await test("la fiche porte un département existant ; un département inconnu est refusé", async () => {
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, departement_code) values ('0101','X','026')`)).ok, true);
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, departement_code) values ('0102','X','999')`)).ok, false);
});

await test("renommer un code de département suit les fiches ; le supprimer vide leur département", async () => {
  await q(`insert into departements(code, libelle) values ('041','Test')`);
  await q(`insert into employes(matricule, nom, departement_code) values ('0103','Y','041')`);
  await q(`update departements set code='042' where code='041'`);
  assert.equal((await one(`select departement_code from employes where matricule='0103'`)).departement_code, "042");
  await q(`delete from departements where code='042'`);
  assert.equal((await one(`select departement_code from employes where matricule='0103'`)).departement_code, null);
});

await test("seuls les rôles avec le droit « Personnel » voient et modifient les départements", async () => {
  assert.equal((await run(u.commercial, `select * from departements`)).rows.length, 0);
  assert.equal((await run(u.commercial, `insert into departements(code, libelle) values ('050','Non')`)).ok, false);
  assert.equal((await run(u.administrateur, `insert into departements(code, libelle) values ('050','Oui')`)).ok, true);
});

console.log("test-personnel-departements : OK");
