// Scénarios SQL du lot SF-4 + LIV-3 (migration 0085) : mouvements de stock à
// la finition et au BL, clôture bloquée par l'en-cours et destinations des
// restes, dépôt obligatoire à l'export, fiche par BL.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const compta = await mkUser("comptabilite");
const rl = await mkUser("responsable_livraison");
const gest = await mkUser("gestionnaire_stock");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client imprimé') returning id`)).id;
await q(`insert into sections(name, display_order, categorie_id) values ('Couture A', 3, (select id from atelier_categories where cle='couture')) on conflict do nothing`);
await as(admin);
await q(`insert into delivery_places(company_id, libelle, par_defaut) values ($1,'Siège',true)`, [company]);

const cat = await one(`insert into product_categories(nom, code_court) values ('T-shirt','TS') returning id`);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const t165 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 165',165,$1,'165') returning id`, [jersey.id]);

/** ODF lancé (validé) ; `imprime` : une impression chiffrée sur la ligne. */
async function launched({ sizes, sections = [], imprime = false, client = company }) {
  await as(admin);
  const odf = await makeOdf(ctx, { admin, company: client, sections, sizes });
  await q(`update product_models set categorie_id=$1, matiere_id=$2, textile_id=$3 where id=$4`, [cat.id, jersey.id, t165.id, odf.model.id]);
  await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [odf.model.id, t165.id]);
  await q(`insert into product_model_colors values ($1,$2)`, [odf.model.id, odf.color.id]);
  await q(`insert into product_model_sizes values ($1,(select id from sizes where cle=$2))`, [odf.model.id, M]);
  await q(`select ensure_variants($1)`, [odf.model.id]);
  if (imprime) {
    const zone = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label) values ($1,'coeur','Cœur') returning id`, [odf.model.id]);
    await q(`insert into production_order_line_printable_zones(production_order_line_id, printable_zone_id) values ($1,$2)`, [odf.line.id, zone.id]);
  }
  await q(`select submit_production_order($1)`, [odf.po.id]);
  await q(`select validate_production_order($1)`, [odf.po.id]);
  const wo = async (cat) => one(`select id from work_orders where production_order_line_id=$1 and section_categorie_cle(section_id)=$2`, [odf.line.id, cat]);
  return { ...odf, fin: await wo("finition"), wo };
}
const movements = (lineId) => q(`select type, quantite_ou_poids::int q, article_ref, shipment_id, depot from stock_movements where production_order_line_id=$1 order by created_at`, [lineId]);

await test("ODF imprimé de 100 pièces livré en 2 BL : 100 entrées personnalisées, 2 sorties totalisant 100", async () => {
  const o = await launched({ sizes: { [M]: 100 }, imprime: true });
  await q(`select declare_production($1,$2,'premier_choix',100)`, [o.fin.id, M]);
  const a = await one(`select id from shipments where production_order_id=$1`, [o.po.id]);
  await as(rl);
  const b = (await one(`select split_shipment($1,$2::jsonb) id`, [a.id, JSON.stringify([{ line_id: o.line.id, taille: M, quantite: 40 }])])).id;
  for (const s of [a.id, b]) {
    await as(rl);
    await q(`select prepare_shipment($1,null,'retrait')`, [s]);
    await as(compta);
    await q(`select validate_shipment_accounting($1,'regle')`, [s]);
    await as(rl);
    await q(`select mark_ready_for_pickup($1)`, [s]);
    await q(`select set_shipment_status($1,'enlevee',null,null,null,'M. Koné')`, [s]);
  }
  const mv = await movements(o.line.id);
  const entrees = mv.filter((m) => m.type === "entree_pf_personnalise");
  const sorties = mv.filter((m) => m.type === "sortie_pf_bl");
  assert.equal(entrees.reduce((t, m) => t + m.q, 0), 100);
  assert.equal(sorties.length, 2);
  assert.equal(sorties.reduce((t, m) => t + m.q, 0), 100);
  assert.ok(entrees.every((m) => m.article_ref.endsWith("P")));
  assert.ok(sorties.every((m) => m.article_ref === entrees[0].article_ref && m.shipment_id));
  // Statut rejoué : pas de seconde sortie.
  await as(admin);
  await q(`select on_shipment_delivered($1)`, [b]);
  assert.equal((await movements(o.line.id)).filter((m) => m.type === "sortie_pf_bl").length, 2);
});

await test("unis : entrée PF vierge ; 2e choix : entrée 2e choix (suffixe D) ; correction : mouvement inverse", async () => {
  const o = await launched({ sizes: { [M]: 20 } });
  await q(`select declare_production($1,$2,'premier_choix',15)`, [o.fin.id, M]);
  await q(`select declare_production($1,$2,'deuxieme_choix',3)`, [o.fin.id, M]);
  const d = await one(`select id from production_declarations where production_order_line_id=$1 and type='premier_choix'`, [o.line.id]);
  await q(`select correct_declaration($1, 2, 'erreur de comptage')`, [d.id]);
  const mv = await movements(o.line.id);
  assert.deepEqual(mv.map((m) => [m.type, m.q]), [["entree_pf", 15], ["entree_2e_choix", 3], ["sortie_pf", 2]]);
  assert.ok(!mv[0].article_ref.endsWith("P") && mv[1].article_ref.endsWith("D"));
});

await test("ODF de stock (sans client) : entrée PF vierge, aucune expédition", async () => {
  const o = await launched({ sizes: { [M]: 10 }, imprime: true, client: null });
  await q(`select declare_production($1,$2,'premier_choix',10)`, [o.fin.id, M]);
  assert.deepEqual((await movements(o.line.id)).map((m) => m.type), ["entree_pf"]);
  assert.equal((await one(`select count(*)::int n from shipments where production_order_id=$1`, [o.po.id])).n, 0);
});

let c;
await test("clôture impossible avec de l'en-cours ; chaque reste reçoit une destination", async () => {
  c = await launched({ sizes: { [M]: 30 }, sections: ["Couture A"], imprime: true });
  const couture = await c.wo("couture");
  await q(`select declare_production($1,$2,'bonne',10)`, [couture.id, M]);
  await q(`select declare_production($1,$2,'premier_choix',8)`, [c.fin.id, M]);
  await expectFail(() => q(`select request_closure($1,'fin de série')`, [c.po.id]), /il reste 22 pièce\(s\) en cours/);
  await expectFail(() => q(`select settle_en_cours($1,$2,21,'dechet','x')`, [couture.id, M]), /il ne reste que 20/);
  await expectFail(() => q(`select settle_en_cours($1,$2,5,'dechet','')`, [couture.id, M]), /motif est obligatoire/);
  // 12 pièces vierges (pas encore imprimées) : terminées et entrées en stock vierge.
  await q(`select settle_en_cours($1,$2,12,'stock_vierge','non imprimées, pour le stock')`, [couture.id, M]);
  await q(`select settle_en_cours($1,$2,6,'dechet','tachées')`, [couture.id, M]);
  // 2 surplus imprimés : gardés pour le client ; 2 livrés.
  await q(`select settle_en_cours($1,$2,2,'stock_personnalise','surplus gardé pour le client')`, [couture.id, M]);
  await q(`select settle_en_cours($1,$2,2,'livre_client','surplus livré et facturé')`, [c.fin.id, M]);
  const bal = await one(`select production_order_balance($1) b`, [c.po.id]);
  assert.equal(bal.b.en_cours, 0);
  const mv = await movements(c.line.id);
  assert.deepEqual(
    mv.map((m) => [m.type, m.q]),
    [["entree_pf_personnalise", 8], ["entree_pf", 12], ["entree_pf_personnalise", 2], ["entree_pf_personnalise", 2]]
  );
  // Expédition : 8 + 2 livrés, jamais les restes gardés en stock.
  assert.equal((await one(`select sum(quantite)::int q from shipment_lines where production_order_line_id=$1`, [c.line.id])).q, 10);
  const decl = await one(`select count(*)::int n from production_declarations where production_order_line_id=$1 and destination='stock_vierge'`, [c.line.id]);
  assert.equal(decl.n, 2); // couture puis finition
  await q(`select request_closure($1,null)`, [c.po.id]);
});

await test("reste au stock non prélevé : abandonné, réservation libérée à la clôture", async () => {
  const s = await launched({ sizes: { [M]: 10 }, sections: ["Stock"] });
  const st = await s.wo("stock");
  await as(gest);
  await q(`select declare_production($1,$2,'preleve',6)`, [st.id, M]);
  await as(admin);
  await expectFail(() => q(`select settle_en_cours($1,$2,4,'dechet','x')`, [st.id, M]), /abandonné/);
  await q(`select settle_en_cours($1,$2,4,'abandon','plus de stock')`, [st.id, M]);
  await q(`select declare_production($1,$2,'premier_choix',6)`, [s.fin.id, M]);
  await q(`select request_closure($1,null)`, [s.po.id]);
  await q(`select confirm_closure($1,true)`, [s.po.id]);
  assert.equal((await one(`select count(*)::int n from stock_reservations where production_order_line_id=$1 and statut='reservee'`, [s.line.id])).n, 0);
});

await test("export : dépôt pré-rempli par nature, obligatoire, modifiable avant export ; fiche par BL", async () => {
  await as(admin);
  await expectFail(() => q(`select * from generate_stock_export_fiche(null)`), /sans dépôt Sage/);
  await q(`update sage_depot_by_nature set depot='PF01' where nature='pf'`);
  const mv = await one(`select id from stock_movements where exported_in_fiche_id is null and type='entree_pf' limit 1`);
  await as(gest);
  await q(`select set_stock_movement_depot($1,'PF02')`, [mv.id]);
  const sh = await one(`select shipment_id from stock_movements where type='sortie_pf_bl' limit 1`);
  const f = await one(`select * from generate_shipment_stock_export_fiche($1)`, [sh.shipment_id]);
  const fiche = await one(`select shipment_id, production_order_id from stock_export_fiches where id=$1`, [f.id]);
  assert.equal(fiche.shipment_id, sh.shipment_id);
  assert.ok(fiche.production_order_id);
  await as(admin);
  await q(`update sage_depot_by_nature set depot='MP01' where nature='mp'`);
  await q(`select * from generate_stock_export_fiche(null)`);
  assert.equal((await one(`select count(*)::int n from stock_movements where depot is null`)).n, 0);
  assert.equal((await one(`select depot from stock_movements where id=$1`, [mv.id])).depot, "PF02");
  await as(gest);
  await expectFail(() => q(`select set_stock_movement_depot($1,'X')`, [mv.id]), /déjà exporté/);
  // Les nouveaux mouvements prennent le dépôt de leur nature.
  await as(admin);
  const o = await launched({ sizes: { [M]: 1 } });
  await q(`select declare_production($1,$2,'premier_choix',1)`, [o.fin.id, M]);
  assert.equal((await movements(o.line.id))[0].depot, "PF01");
});

console.log("SF-4 + LIV-3 : tous les tests passent");
