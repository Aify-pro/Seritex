// Scénarios SQL (migration 0117) : encres = articles consommables, paramètres
// de coût de la sérigraphie.
// 1) famille « Consommables » › sous-famille « Encres » créée et marquée ;
// 2) options d'encre : lues par le personnel, modifiées avec « Modifier » sur Articles ;
// 3) paramètres de coût : Direction (droits Tarification) seulement ;
// 4) le retrait du nuancier 0116 échoue s'il contient des encres.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

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

const u = {};
for (const k of ["administrateur", "responsable_production", "infographiste", "commercial", "livreur"]) u[k] = await mkUser(k);

await test("famille « Consommables » › sous-famille « Encres » créée et marquée encres ; nuancier 0116 retiré", async () => {
  const r = await one(
    `select s.encres from article_families s join article_families f on f.id = s.parent_id where f.nom = 'Consommables' and s.nom = 'Encres'`
  );
  assert.equal(r?.encres, true);
  assert.equal((await one(`select to_regclass('public.encres') as t`)).t, null);
  assert.equal((await one(`select count(*)::int as n from modules where key = 'encres'`)).n, 0);
});

let n = 0;
const nouvelArticle = async () => (await one(`insert into product_models(name, nature) values ($1, 'consommable') returning id`, [`Encre ${++n}`])).id;
const options = (id) => [`insert into article_encres(product_model_id, hex) values ($1, '#D62828')`, [id]];

await test("options d'encre : création et modification avec « Modifier » sur Articles (administrateur, production)", async () => {
  await as(u.administrateur);
  for (const [role, ok] of Object.entries({ administrateur: true, responsable_production: true, infographiste: false, commercial: false })) {
    assert.equal(await can(u[role], ...options(await nouvelArticle())), ok, `${role} : options d'encre`);
  }
  assert.ok((await seen(u.responsable_production, `update article_encres set gamme = 'plastisol' returning product_model_id`)) >= 2);
  assert.equal(await seen(u.infographiste, `update article_encres set gamme = 'eau' returning product_model_id`), 0);
});

await test("options d'encre : lues par tout le personnel (outil de séparation), pas par le livreur", async () => {
  for (const role of ["administrateur", "infographiste", "commercial"]) assert.ok((await seen(u[role], `select 1 from article_encres`)) >= 2, role);
  assert.equal(await seen(u.livreur, `select 1 from article_encres`), 0);
});

await test("paramètres de coût de la sérigraphie : Direction seulement (droits Tarification)", async () => {
  assert.equal(await seen(u.administrateur, `select * from serigraphie_parametres`), 1);
  for (const role of ["responsable_production", "infographiste", "commercial"]) {
    assert.equal(await seen(u[role], `select * from serigraphie_parametres`), 0, `${role} : lecture`);
    assert.equal(await seen(u[role], `update serigraphie_parametres set cout_ecran = 1 returning id`), 0, `${role} : modification`);
  }
  assert.equal(await seen(u.administrateur, `update serigraphie_parametres set cout_ecran = 5000 returning id`), 1);
});

await test("contraintes : couleur #RRGGBB majuscules, dépôt positif", async () => {
  await as(u.administrateur);
  const id = await nouvelArticle();
  await assert.rejects(q(`insert into article_encres(product_model_id, hex) values ($1, '#d62828')`, [id]), /check/);
  await assert.rejects(q(`insert into article_encres(product_model_id, hex, depot_g_m2) values ($1, '#D62828', 0)`, [id]), /check/);
});

await test("0117 échoue si le nuancier 0116 contient des encres (aucune perte silencieuse)", async () => {
  const { setup: setup2 } = await import("./fixture.mjs");
  const ctx = await setup2({ upTo: 116 });
  await ctx.q(`insert into encres(nom, hex) values ('Rouge', '#D62828')`);
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const f = fs.readdirSync(dir).find((x) => x.startsWith("0117_"));
  await assert.rejects(ctx.db.exec(fs.readFileSync(path.join(dir, f), "utf8")), /contient des encres/);
});
