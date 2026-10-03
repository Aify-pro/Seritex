// Scénarios SQL du lot SF-2 (migration 0082) : section Stock en 1re étape,
// réservations, prélèvement → sortie PF, disponible indicatif, découpage.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const gest = await mkUser("gestionnaire_stock");
const M = "Homme/M", L = "Homme/L";
const company = (await one(`insert into companies(name) values ('Client unis') returning id`)).id;
await as(admin);

// Catalogue : T-shirt jersey 165 blanc, déclinaisons M et L.
const cat = await one(`insert into product_categories(nom, code_court) values ('T-shirt','TS') returning id`);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const t165 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 165',165,$1,'165') returning id`, [jersey.id]);

async function odfUnis(sizes, sections = ["Stock"]) {
  const odf = await makeOdf(ctx, { admin, company, sections, sizes });
  await q(`update product_models set categorie_id=$1, matiere_id=$2, textile_id=$3 where id=$4`, [cat.id, jersey.id, t165.id, odf.model.id]);
  await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [odf.model.id, t165.id]);
  await q(`insert into product_model_colors values ($1,$2)`, [odf.model.id, odf.color.id]);
  for (const cle of Object.keys(sizes)) await q(`insert into product_model_sizes values ($1,(select id from sizes where cle=$2))`, [odf.model.id, cle]);
  await q(`select ensure_variants($1)`, [odf.model.id]);
  return odf;
}

let o;
await test("Stock en 1re étape, jamais avec une Coupe ; Finition ajoutée", async () => {
  const bad = await odfUnis({ [M]: 5 }, ["Stock", "Coupe"]);
  await expectFail(() => q(`select submit_production_order($1)`, [bad.po.id]), /Stock OU de la Coupe|première étape/);
  o = await odfUnis({ [M]: 30, [L]: 20 });
  await q(`select submit_production_order($1)`, [o.po.id]);
});

await test("réservations posées à la validation ; disponible indicatif (avertit, ne bloque pas)", async () => {
  const art = await one(`select a.code from variant_stock_articles a join product_variants v on v.id=a.variant_id where v.model_id=$1 and a.etat='vierge' and v.size_id=(select id from sizes where cle=$2)`, [o.model.id, M]);
  await q(`insert into stock_item_view(sage_reference, designation, category, unit, quantity_available, warehouse, quantite_reelle, quantite_reservee) values ($1,'TS blanc M','consommable','U',25,'DEP1',25,0)`, [art.code]);
  await q(`select validate_production_order($1)`, [o.po.id]);
  const res = await q(`select taille, quantite, statut from stock_reservations where production_order_line_id=$1 order by taille`, [o.line.id]);
  assert.deepEqual(res.map((r) => [r.taille, r.quantite, r.statut]), [[L, 20, "reservee"], [M, 30, "reservee"]]);
  const av = await q(`select * from line_stock_availability($1) order by taille`, [o.line.id]);
  const m = av.find((r) => r.taille === M);
  assert.equal(Number(m.en_stock), 25);
  assert.equal(Number(m.disponible), 25); // ses propres réservations ne sont pas déduites
  assert.equal(Number((await one(`select disponible from stock_article_available((select variant_stock_article_id from stock_reservations where production_order_line_id=$1 and taille=$2))`, [o.line.id, M])).disponible), -5);
});

await test("le prélèvement crée une sortie PF ; l'étape suivante ne dépasse pas le prélevé", async () => {
  const stockWo = await one(`select id from work_orders where production_order_line_id=$1 and etape=1`, [o.line.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1 and etape=2`, [o.line.id]);
  await as(gest);
  await q(`select declare_production($1,$2,'preleve',28)`, [stockWo.id, M]);
  const mv = await one(`select type, quantite_ou_poids, article_ref, unite from stock_movements where production_order_line_id=$1`, [o.line.id]);
  assert.deepEqual([mv.type, Number(mv.quantite_ou_poids), mv.unite], ["sortie_pf", 28, "piece"]);
  assert.match(mv.article_ref, /^TS\d{3}JE165/);
  await expectFail(() => q(`select declare_production($1,$2,'preleve',5)`, [stockWo.id, M]), /motif est obligatoire/);
  await q(`select declare_production($1,$2,'preleve',5,'carton abîmé, complément')`, [stockWo.id, M]);
  assert.equal((await one(`select statut from stock_reservations where production_order_line_id=$1 and taille=$2`, [o.line.id, M])).statut, "prelevee");
  await as(admin);
  await expectFail(() => q(`select declare_production($1,$2,'premier_choix',34)`, [fin.id, M]), /jamais plus/);
  await q(`select declare_production($1,$2,'premier_choix',33)`, [fin.id, M]);
});

await test("annulation : réservations libérées", async () => {
  const o2 = await odfUnis({ [M]: 4 });
  await q(`select submit_production_order($1)`, [o2.po.id]);
  await q(`select validate_production_order($1)`, [o2.po.id]);
  await q(`select cancel_production_order($1,'client a annulé')`, [o2.po.id]);
  assert.equal((await one(`select statut from stock_reservations where production_order_line_id=$1`, [o2.line.id])).statut, "liberee");
});

await test("une ligne se découpe : une partie du stock, une partie fabriquée", async () => {
  const o3 = await odfUnis({ [M]: 50, [L]: 10 });
  const nouvelle = (await one(`select split_production_order_line($1,'{"Homme/M":20}'::jsonb) id`, [o3.line.id])).id;
  const a = await one(`select quantity from production_order_lines where id=$1`, [o3.line.id]);
  const b = await one(`select quantity from production_order_lines where id=$1`, [nouvelle]);
  assert.deepEqual([a.quantity, b.quantity], [40, 20]);
  await expectFail(() => q(`select split_production_order_line($1,'{"Homme/M":31}'::jsonb)`, [o3.line.id]), /que 30/);
});
console.log("SF-2 : tous les tests passent");
