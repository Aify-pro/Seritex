// Scénarios SQL de l'étape 3b (migration 0150) : clôture d'un matelas
// regroupé article par article (pièces, couches réelles, justification sans
// tolérance), assemblage automatique en t-shirts complets (minimum sur les
// semi-finis), lots par taille, couverture et écarts, stock tampon, rapport.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client 3b') returning id`)).id;
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id`);
const col = await one(`insert into product_models(name, nature) values ('Col rond','semi_fini') returning id`);
async function odf(n) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [o.model.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md'),($1,'',1,'',$3,null)`, [o.model.id, manche.id, col.id]);
  return o;
}
const A = await odf(30);
const B = await odf(20);

async function ordre(sf, numero, rep, couchesA, couchesB) {
  const f = await one(`insert into fiches_placement(numero_ot, semi_fini_id, designation_article) values ($1,$2,'pièce') returning id`, [numero, sf.id]);
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2),($1,$3)`, [f.id, A.line.id, B.line.id]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,1,$2,$3::jsonb) returning id`, [f.id, numero + "-T1", JSON.stringify(rep)]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,$3),($1,$4,$5)`, [t.id, A.line.id, couchesA, B.line.id, couchesB]);
  await q(`select valider_trace($1)`, [t.id]);
  return t;
}
const tManche = await ordre(manche, "OT-MAN", { [M]: 4 }, 15, 10); // A 60, B 40 manches
const tCol = await ordre(col, "OT-COL", { [M]: 2 }, 15, 10); // A 30, B 20 cols
for (const o of [A, B]) {
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
}
const lignes = (a, b) => JSON.stringify([
  { line_id: A.line.id, couches_reelles: a.couches, obtenus: { [M]: a.pieces } },
  { line_id: B.line.id, couches_reelles: b.couches, obtenus: { [M]: b.pieces } },
]);
const cloturer = (t, a, b, justif = null) =>
  one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,12.5,0.8,$3) r`, [t.id, lignes(a, b), justif]);
const kitsDeclares = async (line) =>
  (await one(`select coalesce(sum(e.quantity),0)::int n from work_order_events e join work_orders w on w.id=e.work_order_id
              where w.production_order_line_id=$1 and e.event_type='matelas_cloture' and e.trace_id is null`, [line])).n;

await test("contrôles : jamais au-dessus du tracé ; manque → justification (aucune tolérance)", async () => {
  await expectFail(() => cloturer(tManche, { couches: 16, pieces: 60 }, { couches: 10, pieces: 40 }), /couches réelles entre 1 et 15/);
  await expectFail(() => cloturer(tManche, { couches: 15, pieces: 61 }, { couches: 10, pieces: 40 }), /au plus 60/);
  await expectFail(() => cloturer(tManche, { couches: 15, pieces: 60 }, { couches: 10, pieces: 38 }), /justification obligatoire/);
});

await test("matelas de manches clôturé : pièces par article, tracé terminé ; pas encore de t-shirt (cols manquants)", async () => {
  await cloturer(tManche, { couches: 15, pieces: 60 }, { couches: 10, pieces: 38 }, "2 manches abîmées");
  assert.equal((await one(`select statut from traces_placement where id=$1`, [tManche.id])).statut, "termine");
  const p = await q(`select production_order_line_id l, quantite from pieces_coupees where trace_id=$1 order by quantite desc`, [tManche.id]);
  assert.deepEqual(p.map((r) => r.quantite), [60, 38]);
  assert.equal(await kitsDeclares(A.line.id), 0);
  const st = await one(`select coupees, assemblees, en_attente from stock_tampon_semi_fini($1) where line_id=$2`, [manche.id, A.line.id]);
  assert.deepEqual([st.coupees, st.assemblees, st.en_attente], [60, 0, 60]);
});

await test("matelas de cols clôturé : assemblage = min(manches ÷ 2, cols ÷ 1) → t-shirts déclarés et lots par taille", async () => {
  const r = (await cloturer(tCol, { couches: 15, pieces: 30 }, { couches: 10, pieces: 20 })).r;
  assert.deepEqual([r.kits_assembles[A.line.id], r.kits_assembles[B.line.id]], [30, 19]);
  assert.equal(await kitsDeclares(A.line.id), 30);
  assert.equal(await kitsDeclares(B.line.id), 19);
  // Lot de t-shirts de l'assemblage (les paquets de pièces, 0153, ont un semi-fini).
  const lots = await one(`select count(*)::int n, sum((composition_taille->>$2)::int)::int q from article_lots where production_order_line_id=$1 and semi_fini_id is null`, [B.line.id, M]);
  assert.deepEqual([lots.n, lots.q], [1, 19]);
  const st = await one(`select coupees, assemblees, en_attente from stock_tampon_semi_fini($1) where line_id=$2`, [col.id, B.line.id]);
  assert.deepEqual([st.coupees, st.assemblees, st.en_attente], [20, 19, 1]); // 1 col en attente (manches manquantes)
});

await test("couverture et écarts : A couvert ; B manque 1 t-shirt → anomalie automatique", async () => {
  const cA = await one(`select coupe, a_couper, ecart from couverture_coupe($1)`, [A.po.id]);
  assert.deepEqual([cA.coupe, cA.a_couper, cA.ecart], [30, 0, 0]);
  const cB = await one(`select coupe, ecart from couverture_coupe($1)`, [B.po.id]);
  assert.deepEqual([cB.coupe, cB.ecart], [19, -1]);
  const a = await one(`select message from production_order_anomalies where cle_auto=$1 and resolved_at is null`, ['ecart_coupe:' + B.line.id]);
  assert.match(a.message, /il manque 1 M/);
});

await test("rapport de production : tissu et déchets du matelas regroupé au prorata des couches", async () => {
  const c = (await one(`select production_report_contenu($1, '{}'::jsonb) c`, [A.po.id])).c;
  // 2 matelas × 12,5 kg × 15/25 couches = 15 kg ; déchets 2 × 0,8 × 0,6 = 0,96 kg.
  assert.equal(Number(c.tissu.kg_reception), 15);
  assert.equal(Number(c.tissu.kg_dechets), 0.96);
  assert.equal(c.tissu.matelas_clotures, 2);
});

await test("un matelas regroupé terminé ne se reclôture pas ; seule la Coupe clôture", async () => {
  await expectFail(() => cloturer(tCol, { couches: 15, pieces: 30 }, { couches: 10, pieces: 20 }), /ne peut pas être clôturé/);
  const commercial = await mkUser("commercial");
  await as(commercial);
  await expectFail(() => cloturer(tManche, { couches: 1, pieces: 1 }, { couches: 1, pieces: 1 }), /réservée à la Coupe/);
  await as(admin);
});

console.log("Étape 3b : tous les tests passent");
