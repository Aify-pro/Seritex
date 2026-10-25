// Scénarios SQL de TR-1a (migration 0147) : statut par tracé, résumé sur la
// fiche, validation avec motif en cas de surplus (aucune tolérance),
// lancement de l'ODF avec un seul tracé Bon pour coupe, droits selon le
// statut, modification / annulation motivées, démarrage et fin du matelas,
// rattrapage ordinaire.
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
const L = "Homme/L";
const company = (await one(`insert into companies(name) values ('Client tracés') returning id`)).id;
await as(admin);

const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 20, [L]: 10 } });
const fiche = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-TR-1',$1,$2) returning id`, [o.model.id, o.line.id]);
const trace = (ordre, rep, plis) =>
  one(`insert into traces_placement(fiche_id, ordre, reference, nb_plis, repartition_par_couche) values ($1,$2,$3,$4,$5::jsonb) returning *`,
    [fiche.id, ordre, `OT-TR-1-T${ordre}`, plis, JSON.stringify(rep)]);
const statut = async (id) => (await one(`select statut from traces_placement where id=$1`, [id])).statut;
const ficheStatut = async () => (await one(`select statut from fiches_placement where id=$1`, [fiche.id])).statut;

let t1, t2;
await test("lancement refusé sans tracé Bon pour coupe ; résumé de la fiche = tracés déposés", async () => {
  t1 = await trace(1, { [M]: 2 }, 10); // 20 M, pas de L : couverture partielle
  assert.equal(t1.statut, "en_preparation");
  assert.equal(await ficheStatut(), "traces_deposes");
  await q(`select submit_production_order($1)`, [o.po.id]);
  await expectFail(() => q(`select validate_production_order($1)`, [o.po.id]), /au moins un tracé « Bon pour coupe »/);
});

await test("valider : plis et répartition exigés ; surplus → motif obligatoire (aucune tolérance)", async () => {
  const vide = await trace(9, {}, null);
  await expectFail(() => q(`select valider_trace($1)`, [vide.id]), /nombre de plis et la répartition/);
  await q(`delete from traces_placement where id=$1`, [vide.id]);
  t2 = await trace(2, { [M]: 1 }, 2); // +2 M au-delà des 20 demandés une fois t1 validé
  assert.deepEqual((await one(`select valider_trace($1) s`, [t1.id])).s, {});
  await expectFail(() => q(`select valider_trace($1)`, [t2.id]), /surplus .* motif est obligatoire/);
  const s = (await one(`select valider_trace($1,'chute de rouleau à utiliser') s`, [t2.id])).s;
  assert.deepEqual(s, { [M]: 2 });
  const v = await one(`select statut, motif_validation, surplus_valide from traces_placement where id=$1`, [t2.id]);
  assert.deepEqual([v.statut, v.motif_validation, v.surplus_valide], ["bon_pour_coupe", "chute de rouleau à utiliser", { [M]: 2 }]);
  assert.equal(await ficheStatut(), "bon_pour_coupe");
});

await test("lancement avec un tracé validé, même si la couverture est partielle (L non tracé)", async () => {
  await q(`select validate_production_order($1)`, [o.po.id]);
  const po = await one(`select status::text s, mention_surplus_traces m from production_orders where id=$1`, [o.po.id]);
  assert.equal(po.s, "en_production");
  assert.deepEqual(po.m, { [`T-shirt blanc — ${M}`]: 2 });
});

let t3;
await test("après lancement : ajout et modification d'un tracé en préparation ; validé figé hors actions", async () => {
  await asAuth(admin, `insert into traces_placement(fiche_id, ordre, reference, nb_plis, repartition_par_couche) values ($1,3,'OT-TR-1-T3',5,'{"Homme/L":2}')`, [fiche.id]);
  t3 = await one(`select * from traces_placement where reference='OT-TR-1-T3'`);
  assert.equal((await asAuth(admin, `update traces_placement set nb_plis=6 where id=$1 returning id`, [t3.id])).length, 1);
  assert.equal((await asAuth(admin, `update traces_placement set nb_plis=99 where id=$1 returning id`, [t1.id])).length, 0);
  assert.equal((await asAuth(admin, `delete from traces_placement where id=$1 returning id`, [t1.id])).length, 0);
  await expectFail(() => asAuth(admin, `update traces_placement set statut='bon_pour_coupe' where id=$1`, [t3.id]), /row-level security/);
});

await test("modifier un tracé validé : motif obligatoire, journalisé, statut conservé", async () => {
  await expectFail(() => q(`select modifier_trace_valide($1,8,'{"Homme/M":2}'::jsonb,600,180,'')`, [t1.id]), /motif est obligatoire/);
  await q(`select modifier_trace_valide($1,9,'{"Homme/M":2}'::jsonb,600,180,'rouleau trop court')`, [t1.id]);
  const t = await one(`select statut, nb_plis, modifie_valide_par from traces_placement where id=$1`, [t1.id]);
  assert.deepEqual([t.statut, t.nb_plis, !!t.modifie_valide_par], ["bon_pour_coupe", 9, true]);
  assert.equal((await one(`select count(*)::int n from audit_log where action='modifier_trace_valide' and entity_id=$1`, [t1.id])).n, 1);
});

await test("annuler : motif obligatoire ; un tracé annulé ne se coupe pas ; fiche reste Bon pour coupe", async () => {
  await expectFail(() => q(`select annuler_trace($1,' ')`, [t2.id]), /motif est obligatoire/);
  await q(`select annuler_trace($1,'surplus inutile finalement')`, [t2.id]);
  assert.equal(await statut(t2.id), "annule");
  const wo = await one(`select id from work_orders where production_order_line_id=$1`, [o.line.id]);
  await expectFail(() => q(`insert into work_order_events(work_order_id, event_type, trace_id, quantity) values ($1,'matelas_cloture',$2,2)`, [wo.id, t2.id]), /annulé : il ne peut pas être coupé/);
  assert.equal(await ficheStatut(), "bon_pour_coupe");
});

await test("matelas : Démarrer → en coupe ; 1re pesée de sac → en coupe ; clôture → terminé", async () => {
  await q(`select demarrer_matelas($1)`, [t1.id]);
  const d = await one(`select statut, demarre_le from traces_placement where id=$1`, [t1.id]);
  assert.deepEqual([d.statut, !!d.demarre_le], ["en_coupe", true]);
  await expectFail(() => q(`select annuler_trace($1,'trop tard')`, [t1.id]), /ne peut plus être annulé/);
  // Second tracé validé puis démarré par la pesée d'un sac.
  await q(`select valider_trace($1,'2 L pour la recoupe')`, [t3.id]); // 12 L pour 10 : surplus motivé
  const sac = await one(`insert into sacs_dechets(code) values ('SAC-TR1') returning id`);
  await q(`insert into sacs_dechets_pesees(sac_id, poids_releve_kg, delta_kg, production_order_id, trace_id) values ($1,0.2,0.2,$2,$3)`, [sac.id, o.po.id, t3.id]);
  assert.equal(await statut(t3.id), "en_coupe");
  const wo = await one(`select id from work_orders where production_order_line_id=$1`, [o.line.id]);
  await q(`insert into work_order_events(work_order_id, event_type, trace_id, quantity, nb_couches_reel) values ($1,'matelas_cloture',$2,18,9)`, [wo.id, t1.id]);
  const t = await one(`select statut, termine_le from traces_placement where id=$1`, [t1.id]);
  assert.deepEqual([t.statut, !!t.termine_le], ["termine", true]);
});

await test("rattrapage : un tracé correctif est un tracé ordinaire en préparation, sans approbation", async () => {
  const r = await one(`insert into traces_placement(fiche_id, ordre, reference, est_correctif, justification) values ($1,10,'OT-TR-1-T10-R',true,'manque 2 M') returning statut`, [fiche.id]);
  assert.equal(r.statut, "en_preparation");
});

await test("droits des actions : sans le droit déverrouiller, pas de modification ni d'annulation d'un tracé validé", async () => {
  const chef = await mkUser("chef_section", { section_id: (await one(`select id from sections where name='Coupe'`)).id });
  const t4 = await trace(11, { [L]: 1 }, 1);
  await q(`select valider_trace($1,'essai')`, [t4.id]);
  const peutDeverrouiller = (await asAuth(chef, `select has_permission('patronnage','unlock') v`))[0].v;
  if (!peutDeverrouiller) {
    await expectFail(() => asAuth(chef, `select annuler_trace($1,'x')`, [t4.id]), /déverrouiller/);
    await expectFail(() => asAuth(chef, `select modifier_trace_valide($1,1,'{}'::jsonb,1,1,'x')`, [t4.id]), /déverrouiller/);
  }
});

console.log("TR-1a : tous les tests passent");
