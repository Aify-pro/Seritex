// Scénarios SQL du lot ART-E (migration 0084) : stock par article stockable —
// miroir Sage, réservé, en cours de production, disponible.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client E') returning id`)).id;
const client = await mkUser("client", { company_id: company });
await q(`insert into sections(name, display_order, categorie_id) values ('Couture A', 3, (select id from atelier_categories where cle='couture')) on conflict do nothing`);
await as(admin);

const cat = await one(`insert into product_categories(nom, code_court) values ('T-shirt','TS') returning id`);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const t165 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 165',165,$1,'165') returning id`, [jersey.id]);

async function catalogue(odf) {
  await q(`update product_models set categorie_id=$1, matiere_id=$2, textile_id=$3 where id=$4`, [cat.id, jersey.id, t165.id, odf.model.id]);
  await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [odf.model.id, t165.id]);
  await q(`insert into product_model_colors values ($1,$2)`, [odf.model.id, odf.color.id]);
  await q(`insert into product_model_sizes values ($1,(select id from sizes where cle=$2))`, [odf.model.id, M]);
  await q(`select ensure_variants($1)`, [odf.model.id]);
}

let o;
await test("stock du miroir Sage, réservé et disponible par article stockable", async () => {
  // ODF de 30 M qui part du stock : réserve 30 à la validation.
  o = await makeOdf(ctx, { admin, company, sections: ["Stock"], sizes: { [M]: 30 } });
  await catalogue(o);
  const art = await one(`select a.id, a.code from variant_stock_articles a join product_variants v on v.id=a.variant_id where v.model_id=$1 and a.etat='vierge'`, [o.model.id]);
  await q(`insert into stock_item_view(sage_reference, designation, category, unit, quantity_available, warehouse, quantite_reelle, quantite_reservee) values ($1,'TS M','consommable','U',40,'DEP1',40,0),($1,'TS M','consommable','U',5,'DEP2',5,0)`, [art.code]);
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
  const rows = await q(`select * from variant_stock_overview($1)`, [o.model.id]);
  assert.equal(rows.length, 3); // vierge, personnalisé, 2e choix
  const v = rows.find((r) => r.etat === "vierge");
  assert.deepEqual([Number(v.en_stock), v.reserve, Number(v.disponible)], [45, 30, 15]);
  assert.equal(Number((await one(`select stock_disponible from article_catalog_figures() where product_model_id=$1`, [o.model.id])).stock_disponible), 15);
});

await test("en cours de production : pièces entrées et pas encore sorties, vierge ou personnalisé", async () => {
  const p = await makeOdf(ctx, { admin, company, sections: ["Couture A"], sizes: { [M]: 20 } });
  await catalogue(p);
  // Impression chiffrée sur la ligne : pièces attendues en article personnalisé.
  const zone = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label) values ($1,'coeur','Cœur') returning id`, [p.model.id]);
  await q(`insert into production_order_line_printable_zones(production_order_line_id, printable_zone_id) values ($1,$2)`, [p.line.id, zone.id]);
  await q(`select submit_production_order($1)`, [p.po.id]);
  await q(`select validate_production_order($1)`, [p.po.id]);
  const couture = await one(`select id from work_orders where production_order_line_id=$1 and etape=1`, [p.line.id]);
  await q(`select declare_production($1,$2,'bonne',20)`, [couture.id, M]);
  const rows = await q(`select etat, en_cours_production from variant_stock_overview($1)`, [p.model.id]);
  assert.equal(rows.find((r) => r.etat === "personnalise").en_cours_production, 20);
  assert.equal(rows.find((r) => r.etat === "vierge").en_cours_production, 0);
  assert.equal((await one(`select line_is_personalized($1) p`, [p.line.id])).p, true);
  assert.equal((await one(`select line_is_personalized($1) p`, [o.line.id])).p, false);
});

await test("réservé au personnel", async () => {
  await as(client);
  await expectFail(() => q(`select * from variant_stock_overview($1)`, [o.model.id]), /accès refusé/);
  await expectFail(() => q(`select * from article_catalog_figures()`), /accès refusé/);
});

console.log("ART-E : tous les tests passent");
