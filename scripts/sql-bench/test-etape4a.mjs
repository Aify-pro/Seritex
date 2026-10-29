// Scénarios SQL de l'étape 4a (migration 0152) : contrat d'étape
// (personnalisation = Impression), verrouillage d'un lot à l'entrée en
// personnalisation, stock tampon par atelier (détenteur, transit),
// destination d'un lot sans le client.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client confidentiel') returning id`)).id;
await q(`insert into sections(name, display_order, categorie_id) values ('Couture A', 3, (select id from atelier_categories where cle='couture')) on conflict do nothing`);
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id`);
const o = await makeOdf(ctx, { admin, company, sections: ["Couture A", "Sérigraphie"], sizes: { [M]: 20 } });
await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',2,'',$2)`, [o.model.id, manche.id]);
await q(`select submit_production_order($1)`, [o.po.id]);
await q(`select validate_production_order($1)`, [o.po.id]);
// La section Sérigraphie devient une section d'impression après le lancement (évite le circuit visuel du lancement).
await q(`update sections set categorie_id=(select id from atelier_categories where cle='impression') where name='Sérigraphie'`);
const wo = async (nom) => one(`select id, section_id from work_orders where production_order_line_id=$1 and section_id=(select id from sections where name=$2)`, [o.line.id, nom]);
const couture = await wo("Couture A");
const serigraphie = await wo("Sérigraphie");
// Un lot créé à la « coupe » (ici sur l'OT couture, comme le scénario SF-5).
const ev = await one(`insert into work_order_events(work_order_id, event_type, quantity, quantites_obtenues) values ($1,'matelas_cloture',20,$2::jsonb) returning id`, [couture.id, JSON.stringify({ [M]: 20 })]);
const lot = await one(`select id, code from article_lots where work_order_event_id=$1`, [ev.id]);

await test("contrat d'étape : Impression est une étape de personnalisation, granularité au kit par défaut", async () => {
  const c = await q(`select cle, personnalise, granularite from atelier_categories order by cle`);
  assert.ok(c.find((r) => r.cle === "impression").personnalise);
  assert.ok(c.filter((r) => r.cle !== "impression").every((r) => !r.personnalise && r.granularite === "kit"));
});

await test("stock tampon : le lot est à la section qui l'a créé, puis en transit, puis chez l'atelier qui le reçoit", async () => {
  assert.deepEqual((await q(`select code from stock_tampon_atelier($1)`, [couture.section_id])).map((r) => r.code), [lot.code]);
  await q(`select scan_article_lot($1,'sortie',$2)`, [lot.code, couture.id]);
  const t = await one(`select en_transit from stock_tampon_atelier($1) where code=$2`, [couture.section_id, lot.code]);
  assert.equal(t.en_transit, true);
  assert.equal((await q(`select code from stock_tampon_atelier($1)`, [serigraphie.section_id])).length, 0);
});

await test("verrouillage : l'entrée en personnalisation verrouille le lot sur sa ligne d'ODF", async () => {
  assert.equal((await one(`select verrouille_le from article_lots where id=$1`, [lot.id])).verrouille_le, null);
  await q(`select scan_article_lot($1,'entree',$2)`, [lot.code, serigraphie.id]);
  const l = await one(`select verrouille_le, verrouille_section_id from article_lots where id=$1`, [lot.id]);
  assert.ok(l.verrouille_le);
  assert.equal(l.verrouille_section_id, serigraphie.section_id);
  const s = await one(`select code, verrouille, en_transit from stock_tampon_atelier($1)`, [serigraphie.section_id]);
  assert.deepEqual([s.code, s.verrouille, s.en_transit], [lot.code, true, false]);
  assert.equal((await q(`select code from stock_tampon_atelier($1)`, [couture.section_id])).length, 0);
});

await test("destination : ODF, article, tailles, composants et couleurs — jamais le client", async () => {
  const d = (await one(`select destination_lot($1) d`, [lot.code.toLowerCase()])).d;
  assert.equal(d.code, lot.code);
  assert.equal(d.odf, o.po.reference);
  assert.deepEqual(d.tailles, { [M]: 20 });
  assert.ok(d.composants.some((c) => c.composant === "Manche courte" && Number(c.quantite) === 2));
  assert.equal(d.verrouille, true);
  assert.equal(d.detenteur, "Sérigraphie");
  assert.ok(!JSON.stringify(d).includes("Client confidentiel"));
});

console.log("Étape 4a : tous les tests passent");
