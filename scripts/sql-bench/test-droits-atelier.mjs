// Scénarios SQL (migration 0112) : gestion des ODF pilotée par la matrice.
// 1) mêmes droits qu'avant ; 2) cocher / décocher une case change réellement
// ce que le rôle voit ou peut faire ; 3) l'opérateur de section garde sa section.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser } = ctx;

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|accès refusé|permission denied/.test(e.message)) return { ok: false, rows: [], msg: e.message };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const seen = async (uid, sql, params) => (await run(uid, sql, params)).rows.length;
const setRight = (roleKey, moduleKey, col, v) =>
  q(`update role_permissions set ${col} = $3 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key=$2)`, [roleKey, moduleKey, v]);

const coupe = await one(`select id from sections where name='Coupe'`);
const confection = await one(`select id from sections where name='Confection'`).catch(() => null);
const u = {};
for (const k of ["administrateur", "commercial", "responsable_production", "infographiste", "gestionnaire_stock", "comptabilite"]) u[k] = await mkUser(k);
u.chef = await mkUser("chef_section", { section_id: coupe.id });
u.livreur = await mkUser("livreur");
await as(u.administrateur);
const company = (await one(`insert into companies(name) values ('Client atelier') returning id`)).id;
const odf = await makeOdf(ctx, { admin: u.administrateur, company, sections: ["Coupe"], sizes: { "Homme/M": 10 } });
const wo = await one(`insert into work_orders(production_order_id, production_order_line_id, section_id, reference, quantity_planned, etape) values ($1,$2,$3,'OT-A1',10,1) returning id`, [odf.po.id, odf.line.id, coupe.id]);

const readOdf = [`select id from production_orders where id=$1`, [odf.po.id]];
const readLines = [`select id from production_order_lines where production_order_id=$1`, [odf.po.id]];
const readOt = [`select id from work_orders where id=$1`, [wo.id]];

await test("lecture d'un ODF : mêmes lecteurs qu'avant", async () => {
  const exp = { administrateur: 1, responsable_production: 1, commercial: 1, gestionnaire_stock: 1, comptabilite: 1, infographiste: 1, livreur: 0 };
  for (const [role, n] of Object.entries(exp)) assert.equal(await seen(u[role], ...readOdf), n, `${role} : lire l'ODF`);
});

await test("lecture des lignes d'ODF : gestion et suivi commercial seulement (comme avant)", async () => {
  const exp = { administrateur: 1, responsable_production: 1, commercial: 1, gestionnaire_stock: 0, comptabilite: 0, infographiste: 0 };
  for (const [role, n] of Object.entries(exp)) assert.equal(await seen(u[role], ...readLines), n, `${role} : lire les lignes`);
});

await test("ordres de travail : la gestion voit tout, l'opérateur sa section seulement", async () => {
  assert.equal(await seen(u.responsable_production, ...readOt), 1);
  assert.equal(await seen(u.chef, ...readOt), 1); // sa section : Coupe
  const autre = await mkUser("chef_section", { section_id: (await one(`select id from sections where id<>$1 limit 1`, [coupe.id])).id });
  assert.equal(await seen(autre, ...readOt), 0); // une autre section
  assert.equal(await seen(u.commercial, ...readOt), 0);
});

await test("écriture d'un ODF : production et administrateur (comme avant)", async () => {
  const upd = [`update production_orders set updated_at = now() where id=$1 returning id`, [odf.po.id]];
  const exp = { administrateur: 1, responsable_production: 1, commercial: 0, gestionnaire_stock: 0, comptabilite: 0, infographiste: 0 };
  for (const [role, n] of Object.entries(exp)) assert.equal(await seen(u[role], ...upd), n, `${role} : modifier l'ODF`);
});

await test("visuels d'un ODF : le commercial dépose sans pouvoir modifier l'ODF (comme avant)", async () => {
  await as(u.administrateur);
  const mf = await one(`insert into media_files(company_id, file_name) values ($1,'maquette.png') returning id`, [company]);
  const ins = (uid) => run(uid, `insert into production_order_media_files(production_order_id, media_file_id, added_by) values ($1,$2,$3)`, [odf.po.id, mf.id, uid]);
  assert.equal((await ins(u.commercial)).ok, true);
  await q(`delete from production_order_media_files where production_order_id=$1`, [odf.po.id]);
  assert.equal((await ins(u.responsable_production)).ok, true);
  await q(`delete from production_order_media_files where production_order_id=$1`, [odf.po.id]);
  assert.equal((await ins(u.infographiste)).ok, false);
  odf.mf = mf;
});

await test("MATRICE : retirer « Voir » sur les ODF à la comptabilité lui masque l'ODF", async () => {
  await setRight("comptabilite", "ordres_fabrication", "can_view", false);
  assert.equal(await seen(u.comptabilite, ...readOdf), 0);
});

await test("MATRICE : « Modifier » sur les ODF ouvre l'écriture à l'infographiste", async () => {
  const upd = [`update production_orders set updated_at = now() where id=$1 returning id`, [odf.po.id]];
  assert.equal(await seen(u.infographiste, ...upd), 0);
  await setRight("infographiste", "ordres_fabrication", "can_modify", true);
  assert.equal(await seen(u.infographiste, ...upd), 1);
});

await test("MATRICE : « Modifier » sur les visuels d'ODF ouvre le dépôt à l'infographiste", async () => {
  await setRight("infographiste", "odf_visuels", "can_modify", true);
  const r = await run(u.infographiste, `insert into production_order_media_files(production_order_id, media_file_id, added_by) values ($1,$2,$3)`, [odf.po.id, odf.mf.id, u.infographiste]);
  assert.equal(r.ok, true);
});

await test("annulation d'un ODF : « Supprimer » sur les ODF (administrateur seulement, comme avant)", async () => {
  const r = await run(u.responsable_production, `select cancel_production_order($1, 'test')`, [odf.po.id]);
  assert.equal(r.ok, false);
  assert.match(r.msg, /accès refusé/);
  await setRight("responsable_production", "ordres_fabrication", "can_delete", true);
  const r2 = await run(u.responsable_production, `select cancel_production_order($1, 'test')`, [odf.po.id]);
  assert.ok(r2.ok || !/accès refusé/.test(r2.msg ?? ""), "avec « Supprimer », le refus de droit disparaît");
});

console.log("Droits d'écriture atelier par la matrice : tous les tests passent");
