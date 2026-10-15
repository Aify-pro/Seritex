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

await test("0130 : machines numériques (DTF, DTG, roll to roll…) et cohérence famille / type / séchage", async () => {
  await as(u.administrateur);
  // Les machines existantes restent de la sérigraphie.
  assert.equal((await one(`select count(*)::int n from machines where famille = 'serigraphie'`)).n, (await one(`select count(*)::int n from machines`)).n);
  for (const type of ["dtf", "dtf_uv", "dtg", "roll_to_roll", "sublimation", "uv_plat", "ecosolvant"]) {
    await q(
      `insert into machines(nom, famille, type, nb_stations, nb_tetes, sechage, nb_canaux_encre, encre_blanche, resolution_dpi, vitesse_m2_h, conso_encre_ml_m2, format_max_l_cm)
       values ($1, 'numerique', $1, 1, 2, 'integre', 5, true, 1440, 8, 12, 60)`,
      [type],
    );
  }
  // Roll to roll : la longueur peut rester libre (format_max_h_cm vide).
  assert.equal((await one(`select format_max_h_cm from machines where nom = 'roll_to_roll'`)).format_max_h_cm, null);
  // Un type numérique ne peut pas être déclaré en sérigraphie, et inversement.
  await assert.rejects(q(`insert into machines(nom, famille, type) values ('Faux 1', 'serigraphie', 'dtf')`), /check/);
  await assert.rejects(q(`insert into machines(nom, famille, type) values ('Faux 2', 'numerique', 'ovale')`), /check/);
  // Fiche technique : bornes.
  await assert.rejects(q(`insert into machines(nom, famille, type, resolution_dpi) values ('Faux 3', 'numerique', 'dtf', 10)`), /check/);
  await assert.rejects(q(`insert into machines(nom, famille, type, nb_canaux_encre) values ('Faux 4', 'numerique', 'dtf', 40)`), /check/);
  await assert.rejects(q(`insert into machines(nom, famille, type, sechage) values ('Faux 5', 'numerique', 'dtf', 'vapeur')`), /check/);
});

await test("0130 : mêmes droits pour les machines numériques (lecture personnel, écriture Direction/production)", async () => {
  const num = `insert into machines(nom, famille, type, nb_stations, nb_tetes, sechage) values ($1, 'numerique', 'dtf', 1, 2, 'four') returning id`;
  assert.equal((await run(u.responsable_production, num, ["DTF prod"])).ok, true);
  assert.equal((await run(u.infographiste, num, ["DTF info"])).ok, false);
  assert.equal((await run(u.commercial, `select id from machines where famille = 'numerique'`)).rows.length > 0, true);
});
