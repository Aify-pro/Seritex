// Scénarios SQL du lot SF-5 (migration 0086) : lots QR de bout en bout —
// scans par section, déclaration qui cite un lot, découpage, regroupement,
// lot mis en colis, traçabilité BL → lot → lot de coupe → matelas → sections.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const rl = await mkUser("responsable_livraison");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client lots') returning id`)).id;
await q(`insert into sections(name, display_order, categorie_id) values ('Couture A', 3, (select id from atelier_categories where cle='couture')) on conflict do nothing`);
const couture = await one(`select id from sections where name='Couture A'`);
const chef = await mkUser("chef_section", { section_id: couture.id });
const chefAutre = await mkUser("chef_section", { section_id: (await one(`select id from sections where name='Sérigraphie'`)).id });

await as(admin);
const o = await makeOdf(ctx, { admin, company, sections: ["Couture A"], sizes: { [M]: 20 } });
await q(`select submit_production_order($1)`, [o.po.id]);
await q(`select validate_production_order($1)`, [o.po.id]);
const woCouture = await one(`select id from work_orders where production_order_line_id=$1 and section_id=$2`, [o.line.id, couture.id]);
const woFin = await one(`select id from work_orders where production_order_line_id=$1 and section_categorie_cle(section_id)='finition'`, [o.line.id]);

// Coupe : fiche de placement de la ligne, un tracé (matelas) clôturé.
const fiche = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-L-1',$1,$2) returning id`, [o.model.id, o.line.id]);
const trace = await one(`insert into traces_placement(fiche_id, ordre, reference, longueur_matelas_cm, largeur_matelas_cm, repartition_par_couche) values ($1,1,'OT-L-1-T1',600,180,'{"Homme/M":2}') returning id`, [fiche.id]);
await q(
  `insert into work_order_events(work_order_id, event_type, trace_id, resultat, quantites_obtenues, nb_couches_reel, longueur_matelas_reelle_cm, poids_tissu_utilise_kg)
   values ($1,'matelas_cloture',$2,'ok','{"Homme/M":20}',10,610,4.2)`,
  [woCouture.id, trace.id]
);

let lotA, lotB, lotC;
await test("lot de coupe : ligne d'ODF déduite du tracé, statut en cours", async () => {
  lotA = await one(`select * from create_article_lot($1,$2,'semi_fini','{"Homme/M":20}'::jsonb)`, [o.po.id, trace.id]);
  const l = await one(`select production_order_line_id, statut from article_lots where id=$1`, [lotA.id]);
  assert.deepEqual([l.production_order_line_id, l.statut], [o.line.id, "en_cours"]);
});

await test("scan d'entrée et de sortie à la section ; jamais dans une section que le lot ne traverse pas", async () => {
  await as(chef);
  const r = await one(`select scan_article_lot($1,'entree') r`, [lotA.code.toLowerCase()]);
  assert.equal(r.r.work_order_id, woCouture.id);
  await as(chefAutre);
  await expectFail(() => q(`select scan_article_lot($1,'entree')`, [lotA.code]), /ne passe pas par votre section/);
  await expectFail(() => q(`select scan_article_lot($1,'entree',$2)`, [lotA.code, woCouture.id]), /n'appartient pas à votre section/);
  await as(chef);
  await expectFail(() => q(`select scan_article_lot($1,'dans')`, [lotA.code]), /sens de scan/);
});

await test("déclaration qui cite le lot", async () => {
  await as(chef);
  const d = (await one(`select declare_production_lot($1,$2,$3,'bonne',20) id`, [lotA.code, woCouture.id, M])).id;
  assert.equal((await one(`select article_lot_id from production_declarations where id=$1`, [d])).article_lot_id, lotA.id);
  // Une déclaration ordinaire ne cite aucun lot.
  await as(admin);
  await q(`select declare_production($1,$2,'premier_choix',1)`, [woFin.id, M]);
  assert.equal((await one(`select article_lot_id from production_declarations where work_order_id=$1 order by created_at desc limit 1`, [woFin.id])).article_lot_id, null);
  await as(chef);
  await q(`select scan_article_lot($1,'sortie')`, [lotA.code]);
});

await test("déclaration groupée du terminal qui cite un lot", async () => {
  await as(admin);
  const x = await makeOdf(ctx, { admin, company, sections: [], sizes: { [M]: 5 } });
  await q(`select submit_production_order($1)`, [x.po.id]);
  await q(`select validate_production_order($1)`, [x.po.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1`, [x.line.id]);
  const lot = await one(`select * from create_article_lot($1,null,'fini','{"Homme/M":5}'::jsonb)`, [x.po.id]);
  await q(`select declare_production_batch_lot($1,$2::jsonb,null,$3)`, [fin.id, JSON.stringify([{ taille: M, type: "premier_choix", quantite: 4 }, { taille: M, type: "deuxieme_choix", quantite: 1 }]), lot.code]);
  assert.equal((await one(`select count(*)::int n from article_lot_events where article_lot_id=$1 and type='declaration'`, [lot.id])).n, 2);
  assert.equal((await one(`select statut from article_lots where id=$1`, [lot.id])).statut, "termine");
  await expectFail(() => q(`select declare_production_batch_lot($1,$2::jsonb,null,$3)`, [woCouture.id, JSON.stringify([{ taille: M, type: "bonne", quantite: 1 }]), lot.code]), /autre article/);
});

await test("découpage puis regroupement", async () => {
  await as(chef);
  lotB = await one(`select * from split_article_lot($1,'{"Homme/M":8}'::jsonb)`, [lotA.code]);
  assert.deepEqual((await one(`select composition_taille c from article_lots where id=$1`, [lotA.id])).c, { [M]: 12 });
  assert.equal((await one(`select parent_lot_id p from article_lots where id=$1`, [lotB.id])).p, lotA.id);
  await expectFail(() => q(`select * from split_article_lot($1,'{"Homme/M":13}'::jsonb)`, [lotA.code]), /ne contient que 12/);
  lotC = await one(`select * from merge_article_lots($1::text[])`, [[lotA.code, lotB.code]]);
  assert.deepEqual((await one(`select composition_taille c from article_lots where id=$1`, [lotC.id])).c, { [M]: 20 });
  assert.equal((await one(`select statut from article_lots where id=$1`, [lotA.id])).statut, "regroupe");
  await expectFail(() => q(`select scan_article_lot($1,'entree')`, [lotA.code]), /n'existe plus/);
});

await test("depuis un BL : lot du colis → lot de coupe → matelas → sections traversées", async () => {
  await as(admin);
  await q(`select declare_production_lot($1,$2,$3,'premier_choix',19)`, [lotC.code, woFin.id, M]);
  assert.equal((await one(`select statut from article_lots where id=$1`, [lotC.id])).statut, "termine");
  const ship = await one(`select id from shipments where production_order_id=$1`, [o.po.id]);
  const pkg = await one(`insert into shipment_packages(shipment_id, numero) values ($1,1) returning id`, [ship.id]);
  await as(rl);
  await q(`select assign_package_lot($1,$2)`, [pkg.id, lotC.code]);
  assert.equal((await one(`select code_qr from shipment_packages where id=$1`, [pkg.id])).code_qr, lotC.code);
  await as(admin);
  const t = (await one(`select shipment_lot_trace($1) t`, [ship.id])).t;
  assert.equal(t.length, 1);
  const tr = t[0].trace;
  assert.equal(tr.lot.code, lotC.code);
  const coupe = tr.origines.find((x) => x.code === lotA.code);
  assert.ok(coupe, "le lot de coupe est retrouvé");
  assert.equal(coupe.trace, "OT-L-1-T1");
  assert.equal(coupe.matelas[0].couches, 10);
  const sections = new Set(tr.parcours.filter((p) => p.section).map((p) => p.section));
  assert.ok(sections.has("Couture A"));
  assert.ok(tr.parcours.some((p) => p.type === "declaration" && p.lot === lotC.code));
  assert.equal(tr.expeditions[0].id, ship.id);
});

await test("clôture de matelas : un lot par taille, relié à la clôture (étiquette imprimée)", async () => {
  await as(admin);
  const trace2 = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,2,'OT-L-1-T2','{"Homme/M":1}') returning id`, [fiche.id]);
  const ev = await one(`insert into work_order_events(work_order_id, event_type, trace_id, resultat, quantites_obtenues) values ($1,'matelas_cloture',$2,'ok','{"Homme/M":6,"Homme/L":0}') returning id`, [woCouture.id, trace2.id]);
  const lots = await q(`select code, matelas_taille, composition_taille c, production_order_line_id, trace_id from article_lots where work_order_event_id=$1`, [ev.id]);
  assert.equal(lots.length, 1);
  assert.deepEqual([lots[0].matelas_taille, lots[0].c, lots[0].production_order_line_id, lots[0].trace_id], [M, { [M]: 6 }, o.line.id, trace2.id]);
  assert.match(lots[0].code, /^LOT-\d{4}-\d{5}$/);
  // Rejouée : pas de doublon.
  assert.equal((await one(`select create_matelas_lots($1) n`, [ev.id])).n, 0);
  // Le lot de l'étiquette se scanne dans la section suivante.
  await as(chef);
  const r = await one(`select scan_article_lot($1,'entree') r`, [lots[0].code]);
  assert.equal(r.r.work_order_id, woCouture.id);
});

console.log("SF-5 : tous les tests passent");
