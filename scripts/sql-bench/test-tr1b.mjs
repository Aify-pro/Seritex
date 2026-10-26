// Scénarios SQL de TR-1b (migration 0148) : couverture de coupe calculée
// (coupé, à couper, en préparation, écart), anomalie automatique et
// notification après chaque matelas, résolution automatique quand l'écart
// revient à zéro, surplus signalé (aucune tolérance).
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser } = ctx;
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
const L = "Homme/L";
const company = (await one(`insert into companies(name) values ('Client écarts') returning id`)).id;
await as(admin);

const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 20, [L]: 10 } });
const fiche = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-EC-1',$1,$2) returning id`, [o.model.id, o.line.id]);
const trace = (ordre, rep, plis) =>
  one(`insert into traces_placement(fiche_id, ordre, reference, nb_plis, repartition_par_couche) values ($1,$2,$3,$4,$5::jsonb) returning id`,
    [fiche.id, ordre, `OT-EC-1-T${ordre}`, plis, JSON.stringify(rep)]);
const couverture = async () =>
  Object.fromEntries((await q(`select * from couverture_coupe($1)`, [o.po.id])).map((r) => [r.taille, [r.demande, r.coupe, r.a_couper, r.en_preparation, r.ecart]]));
const anomalie = () => q(`select message, resolved_at from production_order_anomalies where cle_auto=$1 order by created_at`, ['ecart_coupe:' + o.line.id]);
const outbox = async (cle) => (await one(`select count(*)::int n from notification_outbox where event_key=$1 and entity_id=$2`, [cle, o.po.id])).n;
let wo;
const matelas = (traceId, obtenus, couches) =>
  q(`insert into work_order_events(work_order_id, event_type, trace_id, quantity, quantites_obtenues, nb_couches_reel) values ($1,'matelas_cloture',$2,$3,$4::jsonb,$5)`,
    [wo.id, traceId, Object.values(obtenus).reduce((s, n) => s + n, 0), JSON.stringify(obtenus), couches]);

let t1, t2, t3;
await test("couverture : à couper (validé), en préparation à part, écart par taille ; pas d'anomalie avant la coupe", async () => {
  t1 = await trace(1, { [M]: 2 }, 10);
  await q(`select valider_trace($1)`, [t1.id]);
  t2 = await trace(2, { [M]: 1, [L]: 5 }, 2);
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
  wo = await one(`select id from work_orders where production_order_line_id=$1`, [o.line.id]);
  assert.deepEqual(await couverture(), { [M]: [20, 0, 20, 2, 0], [L]: [10, 0, 0, 10, -10] });
  assert.equal((await anomalie()).length, 0);
});

await test("matelas clôturé avec manque : anomalie automatique + notification « manquant »", async () => {
  await matelas(t1.id, { [M]: 18 }, 9);
  assert.deepEqual(await couverture(), { [M]: [20, 18, 0, 2, -2], [L]: [10, 0, 0, 10, -10] });
  const [a] = await anomalie();
  assert.match(a.message, /il manque 10 L, 2 M/);
  assert.equal(a.resolved_at, null);
  assert.equal(await outbox("ecart_coupe_manquant"), 1);
});

await test("tracé de rattrapage validé : l'écart revient à zéro, l'anomalie se résout seule", async () => {
  await q(`select valider_trace($1)`, [t2.id]);
  assert.deepEqual(await couverture(), { [M]: [20, 18, 2, 0, 0], [L]: [10, 0, 10, 0, 0] });
  const [a] = await anomalie();
  assert.ok(a.resolved_at);
});

await test("surplus après un matelas : signalé (aucune tolérance) puis résolu par l'annulation du tracé non coupé", async () => {
  t3 = await trace(3, { [L]: 1 }, 3);
  await q(`select valider_trace($1,'chute à utiliser')`, [t3.id]);
  assert.equal((await anomalie()).filter((a) => !a.resolved_at).length, 0); // pas de création hors matelas
  await matelas(t2.id, { [M]: 2, [L]: 10 }, 2);
  const ouverte = (await anomalie()).find((a) => !a.resolved_at);
  assert.match(ouverte.message, /surplus \+3 L/);
  assert.equal(await outbox("ecart_coupe_surplus"), 1);
  await q(`select annuler_trace($1,'surplus inutile')`, [t3.id]);
  assert.equal((await anomalie()).filter((a) => !a.resolved_at).length, 0);
  assert.deepEqual(await couverture(), { [M]: [20, 20, 0, 0, 0], [L]: [10, 10, 0, 0, 0] });
});

await test("lecture de la couverture : personnel connecté ; fonctions internes fermées", async () => {
  assert.ok((await asAuth(admin, `select * from couverture_coupe($1)`, [o.po.id])).length === 2);
  const priv = await one(`select has_function_privilege('authenticated','ecart_coupe_actualiser(uuid,boolean)','execute') a,
                                 has_function_privilege('authenticated','couverture_coupe_ligne(uuid)','execute') b`);
  assert.deepEqual([priv.a, priv.b], [false, false]);
});

console.log("TR-1b : tous les tests passent");
