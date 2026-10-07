// Scénarios SQL (migration 0110) : écritures des articles et mouvements de
// rouleaux pilotés par la matrice. 1) mêmes droits qu'avant pour les rôles
// qui y avaient accès ; 2) cocher / décocher une case change réellement ce que
// le rôle peut faire.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|accès refusé|permission denied/.test(e.message)) return { ok: false, rows: [] };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const can = async (uid, sql, params) => (await run(uid, sql, params)).ok;
const affected = async (uid, sql, params) => (await run(uid, sql, params)).rows.length;

const u = {};
for (const k of ["administrateur", "commercial", "responsable_production", "infographiste", "gestionnaire_stock", "comptabilite"]) u[k] = await mkUser(k);
await as(u.administrateur);

const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey A','JA') returning id`);
const pf = await one(`insert into product_models(name, nature, matiere_id) values ('Tee A','pf',$1) returning id`, [jersey.id]);
const tissu = await one(`insert into product_models(name, nature, type_appro, unite, matiere_id) values ('Jersey A','mp','negoce','kg',$1) returning id`, [jersey.id]);
const t1 = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey A 150',150,$1,'150',$2) returning id`, [jersey.id, tissu.id]);
const blanc = await one(`insert into colors(name, code) values ('Blanc A','#fff') returning id`);
await q(`update colors set code_court='BLA' where id=$1`, [blanc.id]);
await q(`insert into textile_sage_articles(textile_id, sage_reference, color_id) values ($1,'TJA150BLA',$2)`, [t1.id, blanc.id]);

let n = 0;
const newModel = () => [`insert into product_models(name, nature) values ($1,'pf')`, [`Modèle ${++n}`]];
const updModel = () => [`update product_models set name = name where id = $1 returning id`, [pf.id]];
const newTextile = () => [`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ($1, 200, $2, $3, $4)`, [`Tissu ${++n}`, jersey.id, `X${n}`, tissu.id]];
const recv = () => [`select * from receive_rolls($1,'[{"sage_reference":"TJA150BLA","laize_cm":178,"poids_kg":20,"bain":"B1"}]'::jsonb)`, [t1.id]];

await test("droits d'avant préservés : créer / modifier un article", async () => {
  const exp = { administrateur: [true, true], responsable_production: [true, true], commercial: [false, false], infographiste: [false, false], gestionnaire_stock: [false, false], comptabilite: [false, false] };
  for (const [role, [creer, modifier]] of Object.entries(exp)) {
    assert.equal(await can(u[role], ...newModel()), creer, `${role} : créer un article`);
    assert.equal(await affected(u[role], ...updModel()) > 0, modifier, `${role} : modifier un article`);
  }
});

await test("droits d'avant préservés : tissus (créer par production et admin)", async () => {
  assert.equal(await can(u.responsable_production, ...newTextile()), true);
  assert.equal(await can(u.administrateur, ...newTextile()), true);
  assert.equal(await can(u.commercial, ...newTextile()), false);
});

await test("suppression d'un tissu : base administrateur seulement (comme avant)", async () => {
  await as(u.administrateur);
  const a = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('À suppr 1',210,$1,'S1',$2) returning id`, [jersey.id, tissu.id]);
  const b = await one(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('À suppr 2',220,$1,'S2',$2) returning id`, [jersey.id, tissu.id]);
  assert.equal(await affected(u.responsable_production, `delete from textiles where id=$1 returning id`, [a.id]), 0);
  assert.equal(await affected(u.administrateur, `delete from textiles where id=$1 returning id`, [b.id]), 1);
});

await test("réception de rouleaux : administrateur, production, gestionnaire de stock (comme avant)", async () => {
  const exp = { administrateur: true, responsable_production: true, gestionnaire_stock: true, commercial: false, infographiste: false, comptabilite: false };
  for (const [role, ok] of Object.entries(exp)) assert.equal(await can(u[role], ...recv()), ok, `${role} : réceptionner un rouleau`);
});

await test("MATRICE : retirer « Modifier » sur Articles à la production lui retire la modification", async () => {
  await q(`update role_permissions set can_modify = false where role_id=(select id from roles where key='responsable_production') and module_id=(select id from modules where key='articles')`);
  assert.equal(await affected(u.responsable_production, ...updModel()), 0);
  assert.equal(await affected(u.administrateur, ...updModel()), 1);
});

await test("MATRICE : donner « Modifier » sur Articles au commercial lui ouvre la modification", async () => {
  assert.equal(await affected(u.commercial, ...updModel()), 0);
  await q(`update role_permissions set can_modify = true where role_id=(select id from roles where key='commercial') and module_id=(select id from modules where key='articles')`);
  assert.equal(await affected(u.commercial, ...updModel()), 1);
});

await test("MATRICE : retirer « Créer » sur Stock au gestionnaire lui retire la réception", async () => {
  await q(`update role_permissions set can_create = false where role_id=(select id from roles where key='gestionnaire_stock') and module_id=(select id from modules where key='stock_atelier')`);
  assert.equal(await can(u.gestionnaire_stock, ...recv()), false);
  assert.equal(await can(u.responsable_production, ...recv()), true);
});

await test("MATRICE : la mise au rebut exige « Supprimer » sur Stock", async () => {
  await as(u.administrateur);
  const [r] = await q(`select * from receive_rolls($1,'[{"sage_reference":"TJA150BLA","laize_cm":170,"poids_kg":15,"bain":"B2"}]'::jsonb)`, [t1.id]);
  await q(`update role_permissions set can_delete = false where role_id=(select id from roles where key='responsable_production') and module_id=(select id from modules where key='stock_atelier')`);
  assert.equal(await can(u.responsable_production, `select scrap_roll((select code from textile_rolls where id=$1), 'abîmé')`, [r.id]), false);
  await q(`update role_permissions set can_delete = true where role_id=(select id from roles where key='responsable_production') and module_id=(select id from modules where key='stock_atelier')`);
  assert.equal(await can(u.responsable_production, `select scrap_roll((select code from textile_rolls where id=$1), 'abîmé')`, [r.id]), true);
});

console.log("Droits d'écriture articles et stock par la matrice : tous les tests passent");
