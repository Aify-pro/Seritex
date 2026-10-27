// Scénarios SQL de l'étape 3a (migration 0149) : ordre de coupe regroupé par
// pièce (semi-fini), articles de plusieurs ODF, couches par article, besoin
// en pièces, validation avec surplus motivé, pas de mélange avec la coupe en
// t-shirts entiers, clôture habituelle refusée, lancement de l'ODF.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;
async function asAuth(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client regroupé') returning id`)).id;
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id`);
const col = await one(`insert into product_models(name, nature) values ('Col rond','semi_fini') returning id`);
// Deux ODF de t-shirts (2 manches + 1 col par pièce), un troisième sans manche.
async function odf(n, avecManche = true) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  if (avecManche) {
    await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [o.model.id]);
    await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md')`, [o.model.id, manche.id]);
  }
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',1,'',$2)`, [o.model.id, col.id]);
  return o;
}
const A = await odf(30);
const B = await odf(20);
const C = await odf(10, false);

let fiche, t1;
await test("ordre regroupé : semi-fini seulement, sans article propre ; besoins listés par article", async () => {
  await expectFail(() => q(`insert into fiches_placement(numero_ot, semi_fini_id) values ('X',$1)`, [A.model.id]), /nature semi-fini/);
  fiche = await one(`insert into fiches_placement(numero_ot, semi_fini_id) values ('OT-RG-1',$1) returning id`, [manche.id]);
  await expectFail(() => q(`insert into fiches_placement(numero_ot, semi_fini_id, production_order_line_id) values ('Y',$1,$2)`, [manche.id, A.line.id]), /regroupee_sans_article/);
  const b = await q(`select article, odf, taille, demandees, reste from besoins_semi_fini($1) order by odf`, [manche.id]);
  assert.deepEqual(b.map((r) => [r.taille, r.demandees, r.reste]).sort(), [[M, 40, 40], [M, 60, 60]].sort());
});

await test("articles regroupés : nomenclature exigée ; couches par article = plis du tracé", async () => {
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2),($1,$3)`, [fiche.id, A.line.id, B.line.id]);
  await expectFail(() => q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fiche.id, C.line.id]), /n'a pas ce semi-fini/);
  t1 = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,1,'OT-RG-1-T1','{"Homme/M":4}') returning id`, [fiche.id]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,15),($1,$3,10)`, [t1.id, A.line.id, B.line.id]);
  assert.equal((await one(`select nb_plis from traces_placement where id=$1`, [t1.id])).nb_plis, 25);
  await expectFail(() => q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,1)`, [t1.id, C.line.id]), /ne fait pas partie/);
});

await test("validation : surplus en pièces par article → motif obligatoire ; prévu déduit du reste", async () => {
  // A : 15 couches × 4 = 60 pour 60 ; B : 10 × 4 = 40 pour 40 → aucun surplus.
  assert.deepEqual((await one(`select valider_trace($1) s`, [t1.id])).s, {});
  const b = await one(`select prevues, reste from besoins_semi_fini($1) where line_id=$2`, [manche.id, A.line.id]);
  assert.deepEqual([b.prevues, b.reste], [60, 0]);
  const t2 = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,2,'OT-RG-1-T2','{"Homme/M":2}') returning id`, [fiche.id]);
  await expectFail(() => q(`select valider_trace($1)`, [t2.id]), /attribuez les couches/);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,1)`, [t2.id, A.line.id]);
  await expectFail(() => q(`select valider_trace($1)`, [t2.id]), /surplus .* motif est obligatoire/);
  const s = (await one(`select valider_trace($1,'recoupe défauts') s`, [t2.id])).s;
  assert.deepEqual(Object.values(s), [2]);
});

await test("pas de mélange : la fiche t-shirt entier d'un article coupé par pièces ne se valide plus", async () => {
  const f = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-A-1',$1,$2) returning id`, [A.model.id, A.line.id]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference, nb_plis, repartition_par_couche) values ($1,1,'OT-A-1-T1',5,'{"Homme/M":2}') returning id`, [f.id]);
  await expectFail(() => q(`select valider_trace($1)`, [t.id]), /coupé par pièces/);
  // Inversement : un article déjà validé en t-shirts entiers ne rejoint pas un ordre regroupé.
  const fc = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-C-1',$1,$2) returning id`, [C.model.id, C.line.id]);
  const tc = await one(`insert into traces_placement(fiche_id, ordre, reference, nb_plis, repartition_par_couche) values ($1,1,'OT-C-1-T1',5,'{"Homme/M":2}') returning id`, [fc.id]);
  await q(`select valider_trace($1)`, [tc.id]);
  const fcol = await one(`insert into fiches_placement(numero_ot, semi_fini_id) values ('OT-RG-2',$1) returning id`, [col.id]);
  await expectFail(() => q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fcol.id, C.line.id]), /soit en t-shirts entiers, soit entièrement par pièces/);
});

await test("clôture habituelle refusée pour un matelas regroupé ; lancement de l'ODF avec le tracé regroupé", async () => {
  await q(`select submit_production_order($1)`, [B.po.id]);
  await q(`select validate_production_order($1)`, [B.po.id]); // tracé regroupé validé avec couches pour B
  const wo = await one(`select id from work_orders where production_order_line_id=$1`, [B.line.id]);
  await expectFail(() => q(`insert into work_order_events(work_order_id, event_type, trace_id, quantity) values ($1,'matelas_cloture',$2,10)`, [wo.id, t1.id]), /se clôture pièce par pièce/);
});

await test("droits : couches figées une fois le tracé validé ; lecture par le personnel", async () => {
  assert.equal((await asAuth(admin, `update trace_couches set nb_couches=1 where trace_id=$1 returning id`, [t1.id])).length, 0);
  assert.ok((await asAuth(admin, `select id from coupe_groupee_lignes where fiche_id=$1`, [fiche.id])).length === 2);
});

console.log("Étape 3a : tous les tests passent");
