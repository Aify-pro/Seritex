// Scénarios SQL du tissu tubulaire / ouvert (migration 0161) : forme des lots
// et rouleaux, plusieurs nomenclatures par article, répartition par taille
// d'une ligne d'ODF, besoins, tracés (D1), assemblage par nomenclature.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client tubulaire') returning id`)).id;
await as(admin);

const sf = async (name) => one(`insert into product_models(name, nature) values ($1,'semi_fini') returning id`, [name]);
const manche = await sf("Manche courte");
const av = await sf("Corps avant");
const ar = await sf("Corps arrière");
const tub = await sf("Corps tubulaire");

const A = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 100 } });
await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [A.model.id]);
await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key)
         values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md'),($1,'',1,'',$3,null),($1,'',1,'',$4,null)`, [A.model.id, manche.id, av.id, ar.id]);

const besoin = async (s) => (await one(`select coalesce(sum(demandees),0)::int n from besoins_semi_fini($1) where line_id=$2`, [s.id, A.line.id])).n;
const repartir = (n) => q(`select repartir_ligne($1,$2,$3::jsonb)`, [A.line.id, nomTub, JSON.stringify({ [M]: n })]);
let nomTub, nomStd;

await test("une ligne sans nomenclature rejoint la principale, créée au besoin", async () => {
  const n = await one(`select id, nom, forme, principale from nomenclatures where product_model_id=$1`, [A.model.id]);
  assert.deepEqual([n.nom, n.forme, n.principale], ["Standard", "ouvert", true]);
  nomStd = n.id;
  assert.equal((await one(`select count(*)::int n from nomenclature_lines where nomenclature_id=$1`, [nomStd])).n, 4);
});

await test("créer une nomenclature tubulaire par copie ; même pièce possible dans chaque nomenclature", async () => {
  await expectFail(() => q(`select creer_nomenclature($1,'X','plat')`, [A.model.id]), /forme invalide/);
  await expectFail(() => q(`select creer_nomenclature($1,'X','ouvert')`, [manche.id]), /seul un produit fini/);
  nomTub = (await one(`select creer_nomenclature($1,'Tubulaire','tubulaire',$2) id`, [A.model.id, nomStd])).id;
  assert.equal((await one(`select count(*)::int n from nomenclature_lines where nomenclature_id=$1`, [nomTub])).n, 4);
  await q(`delete from nomenclature_lines where nomenclature_id=$1 and semi_fini_id in ($2,$3)`, [nomTub, av.id, ar.id]);
  await q(`insert into nomenclature_lines(product_model_id, nomenclature_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,$2,'',1,'',$3)`, [A.model.id, nomTub, tub.id]);
  await expectFail(() => q(`insert into nomenclature_lines(product_model_id, nomenclature_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,$2,'',1,'',$3)`, [A.model.id, nomTub, tub.id]), /nomenclature_lines_semi_fini_zone/);
  await expectFail(() => q(`select supprimer_nomenclature($1)`, [nomStd]), /principale ne se supprime pas/);
});

await test("sans répartition : tout suit la principale, le corps tubulaire n'est pas demandé", async () => {
  assert.equal(await besoin(manche), 200);
  assert.equal(await besoin(av), 100);
  assert.equal(await besoin(tub), 0);
});

await test("répartition par taille : basculer 40 pièces ; contrôles", async () => {
  await expectFail(() => q(`select repartir_ligne($1,$2,$3::jsonb)`, [A.line.id, nomStd, JSON.stringify({ [M]: 10 })]), /principale prend le reste/);
  await expectFail(() => repartir(101), /plus que la quantité demandée/);
  await expectFail(() => q(`select repartir_ligne($1,$2,$3::jsonb)`, [A.line.id, nomTub, JSON.stringify({ "Homme/XXL": 1 })]), /absente/);
  await repartir(40);
  const r = await q(`select nomenclature_id, quantite from repartition_ligne($1) order by quantite`, [A.line.id]);
  assert.deepEqual(r.map((x) => [x.nomenclature_id, x.quantite]), [[nomTub, 40], [nomStd, 60]]);
  assert.equal(await besoin(manche), 200);
  assert.equal(await besoin(av), 60);
  assert.equal(await besoin(ar), 60);
  assert.equal(await besoin(tub), 40);
  await expectFail(() => q(`select definir_nomenclature_principale($1)`, [nomTub]), /déjà répartis ou en coupe/);
  await expectFail(() => q(`select supprimer_nomenclature($1)`, [nomTub]), /utilisée par un ordre/);
});

async function ordre(numero, pieces, couches) {
  const f = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ($1,true,'pièce') returning id`, [numero]);
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, A.line.id]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,$2) returning id`, [f.id, numero + "-T1"]);
  for (const [s, n] of pieces) await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,$4)`, [t.id, s.id, M, n]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,$3)`, [t.id, A.line.id, couches]);
  await q(`select valider_trace($1)`, [t.id]);
  t.pieces = pieces;
  t.couches = couches;
  return t;
}
const cloturer = (t) => one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,12.5,0.8,null) r`, [t.id, JSON.stringify([{
  line_id: A.line.id, couches_reelles: t.couches,
  obtenus: Object.fromEntries(t.pieces.map(([s, n]) => [s.id, { [M]: n * t.couches }])),
}])]);
const kits = async () => (await one(`select coalesce(sum(e.quantity),0)::int n from work_order_events e join work_orders w on w.id=e.work_order_id
  where w.production_order_line_id=$1 and e.event_type='matelas_cloture' and e.trace_id is null`, [A.line.id])).n;
let tManche, tTub, tCorps;

await test("D1 : un tracé mêle des pièces d'une seule nomenclature", async () => {
  const f = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ('OT-MIX',true,'pièce') returning id`);
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, A.line.id]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-MIX-T1') returning id`, [f.id]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,1),($1,$4,$3,1)`, [t.id, tub.id, M, av.id]);
  await expectFail(() => q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,1)`, [t.id, A.line.id]), /n'a pas dans sa nomenclature/);
  await q(`delete from fiches_placement where id=$1`, [f.id]);
});

await test("les tracés couvrent chaque nomenclature ; l'ODF se valide", async () => {
  tManche = await ordre("OT-MAN", [[manche, 4]], 50);
  tTub = await ordre("OT-TUB", [[tub, 2]], 20);
  tCorps = await ordre("OT-CORPS", [[av, 1], [ar, 1]], 60);
  await q(`select submit_production_order($1)`, [A.po.id]);
  await q(`select validate_production_order($1)`, [A.po.id]);
});

await test("assemblage : le tubulaire d'abord, plafonné à sa quantité ; les manches ne servent qu'une fois", async () => {
  await cloturer(tManche);
  assert.equal(await kits(), 0);
  await cloturer(tTub);
  assert.equal(await kits(), 40);
  assert.equal((await one(`select pieces_assemblees($1,$2,$3) n`, [A.line.id, manche.id, M])).n, 80);
  assert.equal((await one(`select pieces_assemblees($1,$2,$3) n`, [A.line.id, tub.id, M])).n, 40);
  await cloturer(tCorps);
  assert.equal(await kits(), 100);
  assert.equal((await one(`select pieces_assemblees($1,$2,$3) n`, [A.line.id, manche.id, M])).n, 200);
  assert.equal((await one(`select pieces_assemblees($1,$2,$3) n`, [A.line.id, av.id, M])).n, 60);
});

await test("répartition : jamais sous les pièces déjà coupées", async () => {
  await expectFail(() => repartir(30), /ne peut pas descendre/);
  await expectFail(() => repartir(50), /ne peut pas descendre/);
});

await test("forme : le rouleau hérite du lot tubulaire ; ouvert par défaut ; correction en stock", async () => {
  const jersey = await one(`insert into textiles(nom, grammage) values ('Jersey tub', 180) returning id`);
  const blanc = await one(`insert into colors(name, code) values ('Blanc tub','#fff') returning id`);
  await q(`insert into textile_sage_articles(textile_id, sage_reference, color_id) values ($1,'TJT180',$2)`, [jersey.id, blanc.id]);
  const donnees = { supplier: "", sage_reference: "TJT180", internal_code: "JE-TUB", dye_batch_number: "18 P05", grammage: 180, laize_cm: 90, unit_cost: 2500 };
  const lotTub = await one(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify({ ...donnees, forme: "tubulaire" })]);
  assert.equal(lotTub.forme, "tubulaire");
  const r = await one(`select * from add_receipt_roll($1, 20)`, [lotTub.id]);
  assert.equal(r.forme, "tubulaire");
  const lotOuv = await one(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify({ ...donnees, dye_batch_number: "18 P06" })]);
  const o = await one(`select * from add_receipt_roll($1, 20)`, [lotOuv.id]);
  assert.equal(o.forme, "ouvert");
  await expectFail(() => q(`select set_roll_forme($1,'plat')`, [o.code]), /forme invalide/);
  await q(`select set_roll_forme($1,'tubulaire')`, [o.code]);
  assert.equal((await one(`select forme from textile_rolls where id=$1`, [o.id])).forme, "tubulaire");
});

await test("coupures : le sac porte sa taille de morceaux ; valeur inconnue refusée", async () => {
  const sac = await one(`select * from create_waste_bag('grande')`);
  assert.equal((await one(`select coupure from sacs_dechets where id=$1`, [sac.id])).coupure, "grande");
  const ancien = await one(`select * from create_waste_bag()`);
  assert.equal((await one(`select coupure from sacs_dechets where id=$1`, [ancien.id])).coupure, null);
  await expectFail(() => q(`select * from create_waste_bag('enorme')`), /sacs_dechets_coupure_valide/);
});

await test("consommation : pondérée par la part de chaque nomenclature", async () => {
  const C = await makeOdf(ctx, { admin, company, sections: [], sizes: { [M]: 100 } });
  const fam = await one(`select id from consumable_families where code_court='BO'`);
  const conso = await one(`insert into consumables(designation, famille_id) values ('Bouton tub',$1) returning id`, [fam.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, consumable_id) values ($1,'Bouton',2,'piece',$2)`, [C.model.id, conso.id]);
  const nom2 = (await one(`select creer_nomenclature($1,'Tub','tubulaire') id`, [C.model.id])).id;
  await q(`insert into nomenclature_lines(product_model_id, nomenclature_id, designation, quantite_par_piece, unite, consumable_id) values ($1,$2,'Bouton',4,'piece',$3)`, [C.model.id, nom2, conso.id]);
  await q(`select repartir_ligne($1,$2,$3::jsonb)`, [C.line.id, nom2, JSON.stringify({ [M]: 25 })]);
  await q(`select submit_production_order($1)`, [C.po.id]);
  await q(`select validate_production_order($1)`, [C.po.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1`, [C.line.id]);
  await q(`select declare_production($1,$2,'premier_choix',100)`, [fin.id, M]);
  await q(`select compute_order_consumption($1)`, [C.po.id]);
  const r = await one(`select quantite_theorique q from production_order_consumptions where production_order_id=$1 and consumable_id=$2`, [C.po.id, conso.id]);
  assert.equal(Number(r.q), 75 * 2 + 25 * 4);
});

await test("répartition : découper ou réduire une taille ramène le basculé dans la quantité demandée", async () => {
  const D = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 50 } });
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',1,'',$2)`, [D.model.id, av.id]);
  const nom = (await one(`select creer_nomenclature($1,'Tub','tubulaire') id`, [D.model.id])).id;
  await q(`insert into nomenclature_lines(product_model_id, nomenclature_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,$2,'',1,'',$3)`, [D.model.id, nom, tub.id]);
  await q(`select repartir_ligne($1,$2,$3::jsonb)`, [D.line.id, nom, JSON.stringify({ [M]: 40 })]);
  await q(`update production_order_sizes set quantite_demandee=30 where production_order_line_id=$1 and taille=$2`, [D.line.id, M]);
  const r = await q(`select quantite, principale from repartition_ligne($1) order by principale`, [D.line.id]);
  assert.deepEqual(r.map((x) => x.quantite), [30, 0]);
  await q(`delete from production_order_sizes where production_order_line_id=$1 and taille=$2`, [D.line.id, M]);
  assert.equal((await one(`select count(*)::int n from production_order_line_nomenclatures where production_order_line_id=$1`, [D.line.id])).n, 0);
});

console.log("Tubulaire / ouvert : tous les tests passent");
