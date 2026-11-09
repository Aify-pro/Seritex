// Scénarios SQL des rouleaux choisis au tracé (migration 0163) : forme du
// tracé, choix par la PAO, réservation au numéro d'ODF, sortie du stock,
// disponibilité, scan au matelas regroupé.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client rouleaux') returning id`)).id;
await as(admin);

const sf = async (name) => one(`insert into product_models(name, nature) values ($1,'semi_fini') returning id`, [name]);
const manche = await sf("Manche courte");
const av = await sf("Corps avant");
const tub = await sf("Corps tubulaire");

async function article(n) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',1,'',$2),($1,'',1,'',$3)`, [o.model.id, manche.id, av.id]);
  const nom = (await one(`select creer_nomenclature($1,'Tubulaire','tubulaire') id`, [o.model.id])).id;
  await q(`insert into nomenclature_lines(product_model_id, nomenclature_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,$2,'',1,'',$3),($1,$2,'',1,'',$4)`, [o.model.id, nom, manche.id, tub.id]);
  await q(`select repartir_ligne($1,$2,$3::jsonb)`, [o.line.id, nom, JSON.stringify({ [M]: n })]);
  return o;
}
const A = await article(40);
const B = await article(20);

const jersey = await one(`insert into textiles(nom, grammage) values ('Jersey R', 180) returning id`);
const blanc = await one(`insert into colors(name, code) values ('Blanc R','#fff') returning id`);
await q(`insert into textile_sage_articles(textile_id, sage_reference, color_id) values ($1,'TJR180',$2)`, [jersey.id, blanc.id]);
const lot = async (forme, bain) => one(`select * from create_stock_receipt($1::jsonb)`, [JSON.stringify({ supplier: "", sage_reference: "TJR180", internal_code: "JE-R", dye_batch_number: bain, grammage: 180, laize_cm: 90, unit_cost: 2500, forme })]);
const lotTub = await lot("tubulaire", "T1");
const lotOuv = await lot("ouvert", "O1");
const rollT1 = await one(`select * from add_receipt_roll($1, 20)`, [lotTub.id]);
const rollT2 = await one(`select * from add_receipt_roll($1, 18)`, [lotTub.id]);
const rollO = await one(`select * from add_receipt_roll($1, 25)`, [lotOuv.id]);

async function trace(numero, o, pieces, couches, forme) {
  const f = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ($1,true,'pièce') returning id`, [numero]);
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, o.line.id]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,$2) returning id`, [f.id, numero + "-T1"]);
  if (forme) await q(`select trace_definir_forme($1,$2)`, [t.id, forme]);
  for (const [s, n] of pieces) await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,$4)`, [t.id, s.id, M, n]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,$3)`, [t.id, o.line.id, couches]);
  return t;
}
const ajouter = (t, r) => q(`select trace_ajouter_rouleau($1,$2)`, [t.id, r.code]);
const reservation = async (r) => (await q(`select odfs, trace_reference from reservations_rouleaux() where code=$1`, [r.code]))[0];
let tA, tB;

await test("forme : un tracé tubulaire refuse un rouleau ouvert ; la forme ne change plus avec des rouleaux de l'autre forme", async () => {
  tA = await trace("OT-TA", A, [[tub, 2]], 20, "tubulaire");
  await expectFail(() => ajouter(tA, rollO), /ne sont pas compatibles/);
  await ajouter(tA, rollT1);
  await expectFail(() => q(`select trace_definir_forme($1,'ouvert')`, [tA.id]), /retirez d'abord/);
});

await test("pièce propre à une forme : refusée sur l'autre à la validation ; pièce commune libre", async () => {
  const t = await trace("OT-MAUVAIS", A, [[tub, 2]], 20, null);
  await expectFail(() => q(`select valider_trace($1)`, [t.id]), /n'existent pas dans cette forme/);
  const m = await trace("OT-MANCHE", A, [[manche, 1]], 40, "ouvert");
  await q(`select valider_trace($1)`, [m.id]);
});

await test("choix sans réservation avant validation ; réservé au numéro d'ODF à la validation", async () => {
  assert.equal(await reservation(rollT1), undefined);
  await q(`select valider_trace($1)`, [tA.id]);
  const r = await reservation(rollT1);
  assert.equal(r.trace_reference, "OT-TA-T1");
  assert.deepEqual(r.odfs, [A.po.reference]);
  assert.equal((await one(`select statut from textile_rolls where id=$1`, [rollT1.id])).statut, "en_stock");
});

await test("réservé : refusé à un autre ODF ; partagé entre tracés du même ODF", async () => {
  tB = await trace("OT-TB", B, [[tub, 2]], 10, "tubulaire");
  await expectFail(() => ajouter(tB, rollT1), /déjà réservé/);
  const memeOdf = await trace("OT-TA2", A, [[manche, 1]], 40, "tubulaire");
  await ajouter(memeOdf, rollT1);
  await expectFail(() => q(`select issue_roll_to_odf($1,$2)`, [rollT1.code, B.po.id]), /réservé pour un autre ODF/);
});

await test("deux tracés en préparation sur un même rouleau : le second validé est refusé", async () => {
  await ajouter(tB, rollT2);
  const t = await trace("OT-TC", A, [[tub, 1]], 1, "tubulaire");
  await ajouter(t, rollT2);
  await q(`select valider_trace($1)`, [tB.id]);
  await expectFail(() => q(`select valider_trace($1,'surplus')`, [t.id]), /vient d'être réservé/);
});

await test("disponibilité : les rouleaux réservés n'y comptent plus", async () => {
  const stock = async () => (await one(`select count(*)::int n from textile_rolls r where r.textile_id=$1 and r.statut='en_stock' and not rouleau_reserve(r.id)`, [jersey.id])).n;
  assert.equal(await stock(), 1);
});

await test("annulation du tracé : le rouleau redevient libre", async () => {
  await q(`select annuler_trace($1,'erreur')`, [tB.id]);
  assert.equal(await reservation(rollT2), undefined);
});

await test("matelas regroupé : scan après sortie vers un ODF du tracé ; forme contrôlée", async () => {
  await expectFail(() => q(`select use_roll_for_matelas_regroupe($1,$2)`, [rollT1.code, tA.id]), /n'a pas été sorti/);
  await q(`select issue_roll_to_odf($1,$2)`, [rollT1.code, A.po.id]);
  await q(`select use_roll_for_matelas_regroupe($1,$2)`, [rollT1.code, tA.id]);
  await q(`select use_roll_for_matelas_regroupe($1,$2)`, [rollT1.code, tA.id]);
  assert.equal((await one(`select count(*)::int n from textile_roll_events where trace_id=$1 and type='matelas'`, [tA.id])).n, 1);
  await q(`select issue_roll_to_odf($1,$2,'deux bains')`, [rollO.code, A.po.id]);
  await expectFail(() => q(`select use_roll_for_matelas_regroupe($1,$2)`, [rollO.code, tA.id]), /ne sont pas compatibles/);
  await expectFail(() => q(`select trace_retirer_rouleau($1,$2)`, [tA.id, rollT1.code]), /déjà scanné/);
});

console.log("Rouleaux au tracé : tous les tests passent");
