// Scénarios SQL (migration 0159) : livre de paie, rubriques, ateliers, alertes.
// 1) coût du mois calculé ; 2) rubriques connues / à classer ; 3) ateliers →
// sections ou structure ; 4) alertes visibles selon le droit « Personnel ».
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
const emp = await one(`insert into employes(matricule, nom, prenom, type_contrat, type_salaire, atelier_source) values ('0001','KONE','AWA','CDI','horaire','bonneterie') returning id`);

await test("fiche : prénom, contrat CDI/CDD, type de salaire mensuel/horaire", async () => {
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, type_contrat) values ('0002','X','CDX')`)).ok, false);
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, type_salaire) values ('0003','X','journalier')`)).ok, false);
  assert.equal((await run(u.administrateur, `insert into employes(matricule, nom, type_contrat, type_salaire) values ('0004','X','CDD','mensuel')`)).ok, true);
});

await test("coût du mois : coût total Sage s'il existe, sinon somme des composantes (indemnités et transport compris)", async () => {
  await q(`insert into paies_mensuelles(employe_id, mois, salaire_base, primes, heures_sup, indemnites, avantages, charges_patronales, cout_total_sage)
           values ($1,'2026-09-01',100000,36000,5000,20000,0,30000,200000)`, [emp.id]);
  await q(`insert into paies_mensuelles(employe_id, mois, salaire_base, primes, heures_sup, indemnites, avantages, charges_patronales)
           values ($1,'2026-10-01',100000,36000,5000,20000,0,30000)`, [emp.id]);
  const r = (await run(u.administrateur, `select mois::text, cout_mois::float8 as c from paies_mensuelles order by mois`)).rows;
  assert.deepEqual(r.map((x) => x.c), [200000, 191000]);
});

await test("détail par rubrique conservé, retenues comprises (pour expliquer l'écart avec Sage)", async () => {
  await q(`update paies_mensuelles set detail = '{"620": -7000, "100": 100000}'::jsonb where mois='2026-09-01'`);
  const r = (await run(u.administrateur, `select detail->>'620' as d from paies_mensuelles where mois='2026-09-01'`)).rows;
  assert.equal(r[0].d, "-7000");
});

await test("rubriques : celles du livre Sage sont classées ; une nouvelle reste « à classer »", async () => {
  const r = (await run(u.administrateur, `select code, categorie from paie_rubriques`)).rows;
  const cat = Object.fromEntries(r.map((x) => [x.code, x.categorie]));
  assert.equal(cat["100"], "salaire_base");
  assert.equal(cat["800"], "prime", "le transport est une prime");
  assert.equal(cat["1990"], "indemnite");
  assert.equal(cat["COUT_TOTAL"], "controle");
  assert.equal(cat["620"], "retenue");
  assert.ok(r.length >= 45);
  assert.equal((await run(u.administrateur, `insert into paie_rubriques(code, libelle) values ('7777','Nouvelle')`)).ok, true);
  assert.equal((await run(u.administrateur, `select categorie from paie_rubriques where code='7777'`)).rows[0].categorie, null);
  assert.equal((await run(u.administrateur, `update paie_rubriques set categorie='machin' where code='7777'`)).ok, false);
});

await test("ateliers : bureau, direction, commercial sont de la structure ; un atelier est une section OU de la structure", async () => {
  const r = (await run(u.administrateur, `select atelier, structure from ateliers_vers_sections order by atelier`)).rows;
  const st = Object.fromEntries(r.map((x) => [x.atelier, x.structure]));
  assert.deepEqual([st.bureau, st.direction, st.commercial, st.bonneterie], [true, true, true, false]);
  assert.equal(r.length, 15);
  const s = await one(`insert into sections(name) values ('Section test') returning id`);
  assert.equal((await run(u.administrateur, `update ateliers_vers_sections set section_id=$1 where atelier='bonneterie'`, [s.id])).ok, true);
  assert.equal((await run(u.administrateur, `update ateliers_vers_sections set section_id=$1 where atelier='bureau'`, [s.id])).ok, false, "structure et section à la fois");
});

await test("ces tables ne sont visibles et modifiables que par le droit « Personnel »", async () => {
  for (const role of ["commercial", "responsable_production"]) {
    for (const t of ["paie_rubriques", "ateliers_vers_sections", "alertes"]) {
      assert.equal((await run(u[role], `select * from ${t}`)).rows.length, 0, `${role} : lecture ${t}`);
    }
    assert.equal((await run(u[role], `update paie_rubriques set categorie='ignore' where code='100'`)).rows.length, 0, `${role} : écriture rubrique`);
  }
});

await test("alertes : créées et vues avec le droit du module, traitées avec « valider »", async () => {
  const ins = await run(u.administrateur, `insert into alertes(type, gravite, titre, module_cible) values ('livre_paie','critique','Livre identique','personnel') returning id`);
  assert.equal(ins.ok, true);
  assert.equal((await run(u.administrateur, `select * from alertes`)).rows.length, 1);
  assert.equal((await run(u.commercial, `select * from alertes`)).rows.length, 0);
  assert.equal((await run(u.commercial, `insert into alertes(type, titre, module_cible) values ('x','y','personnel')`)).ok, false);
  assert.equal((await run(u.administrateur, `insert into alertes(type, gravite, titre, module_cible) values ('x','grave','y','personnel')`)).ok, false, "gravité connue");
  const t = await run(u.administrateur, `update alertes set statut='traitee', traitee_par=$1 where id=$2 returning statut`, [u.administrateur, ins.rows[0].id]);
  assert.equal(t.rows[0].statut, "traitee");
});

await test("un lot d'import garde empreinte, comparatif et motif de validation", async () => {
  const r = await run(u.administrateur, `insert into imports_personnel(type, mois, empreinte, comparatif, rubriques_a_classer, motif_validation)
    values ('paie','2026-10-01','abc','{"variation_pct": 3}'::jsonb, array['7777'], 'Mois de rattrapage validé par la direction') returning id`);
  assert.equal(r.ok, true);
  assert.equal((await run(u.administrateur, `select rubriques_a_classer from imports_personnel`)).rows[0].rubriques_a_classer[0], "7777");
});

console.log("test-personnel-paie : OK");
