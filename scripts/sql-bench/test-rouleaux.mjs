// Scénarios SQL des rouleaux de tissu (migration 0096) : réception (saisie et
// import), sortie vers un ODF (pesée et sortie MP), bain de teinture,
// scan à la coupe, retour pesé, grammage réel estimé.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const gest = await mkUser("gestionnaire_stock");
const commercial = await mkUser("commercial");
const coupe = await one(`select id from sections where name='Coupe'`);
const chef = await mkUser("chef_section", { section_id: coupe.id });
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client rouleaux') returning id`)).id;
await as(admin);
const jersey = await one(`insert into textiles(nom, grammage) values ('Jersey 180 R', 180) returning id`);
const blanc = await one(`insert into colors(name, code) values ('Blanc R','#fff') returning id`);
await q(`insert into textile_sage_articles(textile_id, sage_reference, color_id) values ($1,'TJB180BL',$2)`, [jersey.id, blanc.id]);

let r1, r2, r3;
await test("réception : saisie et import, coloris contrôlé, code ROL- attribué", async () => {
  await as(commercial);
  await expectFail(() => q(`select * from receive_rolls($1,'[{"poids_kg":20}]'::jsonb)`, [jersey.id]), /gestion de stock/);
  await as(gest);
  [r1] = await q(`select * from receive_rolls($1,$2::jsonb)`, [jersey.id, JSON.stringify([{ sage_reference: "TJB180BL", bain: "B12", numero_fournisseur: "F-001", laize_cm: 180, poids_kg: 22.5 }])]);
  assert.match(r1.code, /^ROL-\d{4}-\d{5}$/);
  const lots = await q(`select * from receive_rolls($1,$2::jsonb,'import')`, [
    jersey.id,
    JSON.stringify([
      { sage_reference: "TJB180BL", bain: "B12", numero_fournisseur: "F-002", laize_cm: 178, poids_kg: 21 },
      { sage_reference: "TJB180BL", bain: "B13", numero_fournisseur: "F-003", laize_cm: 182, poids_kg: 20 },
    ]),
  ]);
  [r2, r3] = lots;
  const row = await one(`select color_id, statut, source from textile_rolls where id=$1`, [r2.id]);
  assert.deepEqual([row.color_id, row.statut, row.source], [blanc.id, "en_stock", "import"]);
  await expectFail(() => q(`select * from receive_rolls($1,'[{"sage_reference":"AUTRE","poids_kg":5}]'::jsonb)`, [jersey.id]), /n'est pas un coloris/);
  await expectFail(() => q(`select * from receive_rolls($1,'[{"numero_fournisseur":"F-001","poids_kg":5}]'::jsonb)`, [jersey.id]), /unique/);
});

let o, woCoupe, trace;
await test("sortie vers un ODF : pesée et sortie MP ; deux bains exigent un motif", async () => {
  await as(admin);
  o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 50 }, status: "en_production" });
  await q(`insert into work_orders(production_order_id, production_order_line_id, section_id, reference, quantity_planned, etape) values ($1,$2,$3,'OT-R',50,1)`, [o.po.id, o.line.id, coupe.id]);
  woCoupe = await one(`select id from work_orders where production_order_line_id=$1`, [o.line.id]);
  await as(gest);
  await q(`select issue_roll_to_odf($1,$2)`, [r1.code, o.po.id]);
  const mv = await one(`select type, article_ref, quantite_ou_poids::numeric q from stock_movements where production_order_id=$1`, [o.po.id]);
  assert.deepEqual([mv.type, mv.article_ref, Number(mv.q)], ["sortie_mp", "TJB180BL", 22.5]);
  await q(`select issue_roll_to_odf($1,$2)`, [r2.code, o.po.id]); // même bain : pas de motif
  await expectFail(() => q(`select issue_roll_to_odf($1,$2)`, [r3.code, o.po.id]), /mélanger deux bains exige un motif/);
  await expectFail(() => q(`select issue_roll_to_odf($1,$2)`, [r1.code, o.po.id]), /n'est pas en stock/);
});

await test("à la coupe : le rouleau est scanné sur le matelas ; retour pesé, grammage réel estimé", async () => {
  await as(admin);
  const fiche = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-R-1',$1,$2) returning id`, [o.model.id, o.line.id]);
  trace = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,1,'OT-R-1-T1','{"Homme/M":5}') returning id`, [fiche.id]);
  await as(chef);
  await expectFail(() => q(`select use_roll_for_matelas($1,$2,$3)`, [r3.code, woCoupe.id, trace.id]), /n'a pas été sorti pour cet ODF/);
  await q(`select use_roll_for_matelas($1,$2,$3)`, [r1.code, woCoupe.id, trace.id]);
  // Matelas : 6 m × 1,80 m × 10 couches = 108 m².
  await as(admin);
  await q(
    `insert into work_order_events(work_order_id, event_type, trace_id, resultat, quantites_obtenues, nb_couches_reel, longueur_matelas_reelle_cm, laize_reelle_cm, poids_tissu_utilise_kg)
     values ($1,'matelas_cloture',$2,'ok','{"Homme/M":50}',10,600,180,19.4)`,
    [woCoupe.id, trace.id]
  );
  await as(gest);
  await expectFail(() => q(`select return_roll($1, 30)`, [r1.code]), /plus lourd/);
  const consomme = (await one(`select return_roll($1, 3.06) c`, [r1.code])).c;
  assert.equal(Number(consomme), 19.44);
  const mv = await one(`select type, quantite_ou_poids::numeric q from stock_movements where production_order_id=$1 and type='retour_mp'`, [o.po.id]);
  assert.equal(Number(mv.q), 3.06);
  const s = (await one(`select roll_summary($1) s`, [r1.code])).s;
  assert.equal(Number(s.consomme_kg), 19.44);
  assert.equal(Number(s.grammage_reel), 180); // 19,44 kg / 108 m²
  assert.equal((await one(`select statut, production_order_id from textile_rolls where id=$1`, [r1.id])).statut, "en_stock");
});

await test("rouleau vidé : épuisé ; rebut motivé, impossible en production", async () => {
  await as(gest);
  await q(`select return_roll($1, 0)`, [r2.code]);
  assert.equal((await one(`select statut from textile_rolls where id=$1`, [r2.id])).statut, "epuise");
  await expectFail(() => q(`select scrap_roll($1,'')`, [r3.code]), /motif est obligatoire/);
  await q(`select scrap_roll($1,'taché')`, [r3.code]);
  assert.equal((await one(`select statut from textile_rolls where id=$1`, [r3.id])).statut, "rebut");
});

await test("mouvements : motif « Coupe pour ODF » et rouleau cité ; vue des articles en stock", async () => {
  await as(admin);
  const mvs = await q(`select type, commentaire, textile_roll_id from stock_movements where production_order_id=$1 order by created_at`, [o.po.id]);
  const sortie = mvs.find((m) => m.type === "sortie_mp" && m.textile_roll_id === r1.id);
  assert.match(sortie.commentaire, new RegExp(`^Coupe pour ODF ${o.po.reference} — rouleau ${r1.code} \\(bain B12\\)`));
  const retour = mvs.find((m) => m.type === "retour_mp" && m.textile_roll_id === r1.id);
  assert.match(retour.commentaire, /^Retour de coupe ODF/);
  await q(`insert into stock_item_view(sage_reference, designation, category, unit, quantity_available, warehouse, quantite_reelle, quantite_reservee) values ('TJB180BL','Jersey blanc','tissu','KG',250,'D1',250,0)`);
  const article = await one(`select product_model_id from textiles where id=$1`, [jersey.id]);
  const row = await one(`select * from stock_articles_overview() where product_model_id=$1`, [article.product_model_id]);
  assert.equal(row.nature, "mp");
  assert.equal(Number(row.en_stock), 250);
  assert.deepEqual(row.references_sage, ["TJB180BL"]);
  assert.equal(row.rouleaux_stock, 1); // r1 revenu ; r2 épuisé ; r3 au rebut
  assert.equal(Number(row.rouleaux_kg), 3.06);
  await as(commercial);
  assert.ok((await q(`select * from stock_articles_overview()`)).length > 0);
});

console.log("Rouleaux : tous les tests passent");
