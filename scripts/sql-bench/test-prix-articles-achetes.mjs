// Scénarios SQL des prix des tissus et consommables (migration 0104) : prix
// calculé (achat + frais × coefficient) ou saisi, valeur de l'article
// surchargée par déclinaison, prix de vente lisibles sans aucun coût.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
async function asAuth(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
await as(admin);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const tissu = await one(`insert into product_models(name, nature, type_appro, unite, matiere_id) values ('Jersey P','mp','negoce','kg',$1) returning id`, [jersey.id]);
await q(`insert into textiles(nom, grammage, matiere_id, code_court, product_model_id) values ('Jersey P',180,$1,'180',$2)`, [jersey.id, tissu.id]);
const blanc = await one(`insert into colors(name, code) values ('Blanc P','#fff') returning id`);
await q(`update colors set code_court='BLP' where id=$1`, [blanc.id]);
const noir = await one(`insert into colors(name, code) values ('Noir P','#000') returning id`);
await q(`update colors set code_court='NOP' where id=$1`, [noir.id]);
await q(`insert into product_model_colors values ($1,$2),($1,$3)`, [tissu.id, blanc.id, noir.id]);
await q(`select ensure_variants($1)`, [tissu.id]);
const prix = async () => q(`select code, prix_vente::numeric p, source, manquant from article_variant_prices($1) order by code`, [tissu.id]);

await test("sans prix : manquant signalé, jamais 0", async () => {
  const r = await prix();
  assert.ok(r.every((x) => x.p === null && x.manquant === "prix d'achat non saisi"));
});

await test("prix calculé : 3 000 F/kg + 10 % de frais × coefficient → 6 500 ; surcharge saisie sur une déclinaison", async () => {
  await q(`insert into model_pricing(product_model_id, prix_achat, frais_pct) values ($1, 3000, 10)`, [tissu.id]);
  assert.deepEqual((await prix()).map((x) => [x.code, Number(x.p), x.source]), [["JE180BLP", 6500, "calcule"], ["JE180NOP", 6500, "calcule"]]);
  const noirV = await one(`select id from product_variants where model_id=$1 and color_id=$2`, [tissu.id, noir.id]);
  await q(`insert into variant_pricing(variant_id, mode_prix, prix_vente) values ($1,'saisi',7000)`, [noirV.id]);
  assert.deepEqual((await prix()).map((x) => [x.code, Number(x.p), x.source]), [["JE180BLP", 6500, "calcule"], ["JE180NOP", 7000, "saisi"]]);
  // Coefficient imposé : il s'applique aussi aux articles achetés.
  await q(`update pricing_settings set coef_prix_vente = 2`);
  assert.equal(Number((await prix())[0].p), 6600);
  await q(`update pricing_settings set coef_prix_vente = null`);
  assert.equal(Number((await one(`select prix_a_partir_de from article_catalog_figures() where product_model_id=$1`, [tissu.id])).prix_a_partir_de), 6500);
});

await test("le commercial lit les prix de vente, jamais les coûts", async () => {
  const r = await asAuth(commercial, `select prix_vente from article_variant_prices($1)`, [tissu.id]);
  assert.equal(r.length, 2);
  assert.equal((await asAuth(commercial, `select count(*)::int n from variant_pricing`))[0].n, 0);
  assert.equal((await asAuth(commercial, `select count(*)::int n from model_pricing`))[0].n, 0);
  await expectFail(() => asAuth(commercial, `insert into variant_pricing(variant_id, prix_vente) select id, 1 from product_variants limit 1`), /row-level security/);
});

console.log("Prix des articles achetés : tous les tests passent");
