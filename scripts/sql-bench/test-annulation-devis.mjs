// Scénarios SQL de la migration 0178 : annulation d'un devis (même accepté,
// ODF en production) par l'administrateur ou la Direction, avec motif ; l'ODF
// est annulé avec lui, la demande rouverte ; les pièces déjà coupées restent
// en stock tampon, signalées, et se réorientent vers un autre ODF.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;
async function comme(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const admin = await mkUser("administrateur");
const direction = await mkUser("direction");
const commercial = await mkUser("commercial");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client annulation') returning id`)).id;
const manche = await one(`insert into product_models(name, nature) values ('Manche annul','semi_fini') returning id`);
// Le col n'est pas coupé : aucune manche n'est encore assemblée en t-shirt.
const col = await one(`insert into product_models(name, nature) values ('Col annul','semi_fini') returning id`);

async function devis(ref, statut = "accepte") {
  await as(null);
  const request = (await one(`insert into requests(reference, company_id, status, description) values ($1,$2,'acceptee','d') returning id`, [`DEM-${ref}`, company])).id;
  const quote = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ($1,$2,$3,$4,1000) returning id`, [ref, request, company, statut])).id;
  return { request, quote };
}
async function odf(n, quote = null) {
  await as(admin);
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',2,'',$2),($1,'',1,'',$3)`, [o.model.id, manche.id, col.id]);
  if (quote) await q(`update production_orders set quote_id=$1 where id=$2`, [quote, o.po.id]);
  return o;
}

// Devis A accepté, son ODF en production ; ODF B (autre client) en production, même couleur.
const DA = await devis("DEV-ANN-A");
const A = await odf(30, DA.quote);
const B = await odf(20);
await q(`update production_order_lines set couleur_unique_id=(select couleur_unique_id from production_order_lines where id=$1) where id=$2`, [A.line.id, B.line.id]);
// Manches coupées par ordre regroupé : 60 pour A, 40 pour B (rien d'assemblé : pas d'autre pièce).
const f = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ('OT-ANN',true,'Manche annul') returning id`);
for (const o of [A, B]) await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, o.line.id]);
const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-ANN-T1') returning id`, [f.id]);
await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,4)`, [t.id, manche.id, M]);
await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,15),($1,$3,10)`, [t.id, A.line.id, B.line.id]);
await q(`select valider_trace($1,'marge')`, [t.id]);
for (const o of [A, B]) {
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
}
await one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,15,1,null) r`, [t.id, JSON.stringify([
  { line_id: A.line.id, couches_reelles: 15, obtenus: { [manche.id]: { [M]: 60 } } },
  { line_id: B.line.id, couches_reelles: 10, obtenus: { [manche.id]: { [M]: 40 } } },
])]);

await test("droits : le commercial ne peut pas annuler, motif obligatoire", async () => {
  await expectFail(() => comme(commercial, `select annuler_devis($1,'x')`, [DA.quote]), /réservée à l'administrateur et à la Direction/);
  await expectFail(() => comme(direction, `select annuler_devis($1,'  ')`, [DA.quote]), /motif de l'annulation est obligatoire/);
  assert.equal((await comme(commercial, `select count(*)::int n from annulation_devis_apercu($1)`, [DA.quote]))[0].n, 0);
});

await test("aperçu : l'ODF en production et ses paquets en stock tampon", async () => {
  const r = await comme(direction, `select reference, statut, paquets, pieces, annulable from annulation_devis_apercu($1)`, [DA.quote]);
  assert.deepEqual(r.map((x) => [x.reference, x.statut, x.paquets, x.pieces, x.annulable]), [[A.po.reference, "en_production", 1, 60, true]]);
});

await test("garde-fou : on ne passe pas un devis à « annulé » par une simple mise à jour", async () => {
  await expectFail(() => comme(admin, `update quotes set status='annule' where id=$1`, [DA.quote]), /par l'action « Annuler le devis »/);
});

await test("annuler (Direction) : devis et ODF annulés, demande rouverte, l'autre ODF intact", async () => {
  const r = (await comme(direction, `select annuler_devis($1,'Le client renonce à la commande') r`, [DA.quote]))[0].r;
  assert.deepEqual(r, { odf: [A.po.reference], demande_rouverte: true });
  const d = await one(`select status, annule_motif, annule_par from quotes where id=$1`, [DA.quote]);
  assert.deepEqual([d.status, d.annule_motif, d.annule_par], ["annule", "Le client renonce à la commande", direction]);
  const po = await one(`select status, cloture_note from production_orders where id=$1`, [A.po.id]);
  assert.equal(po.status, "annulee");
  assert.equal(po.cloture_note, "Annulé avec le devis DEV-ANN-A : Le client renonce à la commande");
  assert.equal((await one(`select status from requests where id=$1`, [DA.request])).status, "en_analyse");
  assert.equal((await one(`select status from production_orders where id=$1`, [B.po.id])).status, "en_production");
  assert.equal((await one(`select count(*)::int n from status_history where entity_id in ($1,$2,$3)`, [DA.quote, A.po.id, DA.request])).n >= 3, true);
});

await test("devis annulé : plus d'acceptation, plus de changement de statut, pas de seconde annulation", async () => {
  await expectFail(() => comme(admin, `select accept_quote($1)`, [DA.quote]), /n'est pas en attente/);
  await expectFail(() => comme(admin, `update quotes set status='envoye' where id=$1`, [DA.quote]), /annulé ne change plus de statut/);
  await expectFail(() => comme(admin, `select annuler_devis($1,'encore')`, [DA.quote]), /déjà annulé/);
});

await test("stock tampon : les pièces de l'ODF annulé restent, signalées", async () => {
  const st = await comme(admin, `select odf, coupees, en_attente, odf_annule from stock_tampon_semi_fini($1)`, [manche.id]);
  const a = st.find((x) => x.odf === A.po.reference);
  assert.deepEqual([a.coupees, a.en_attente, a.odf_annule], [60, 60, true]);
  assert.equal(st.find((x) => x.odf === B.po.reference).odf_annule, false);
  const p = await comme(admin, `select odf, odf_annule from paquets_semi_fini($1)`, [manche.id]);
  assert.deepEqual(p.find((x) => x.odf === A.po.reference).odf_annule, true);
  const pa = await comme(admin, `select code, semi_fini, composition_taille from paquets_odf($1)`, [A.po.id]);
  assert.deepEqual([pa.length, pa[0].semi_fini, pa[0].composition_taille], [1, "Manche annul", { [M]: 60 }]);
});

await test("réattribution : un paquet de l'ODF annulé se réoriente vers un ODF en production", async () => {
  const code = (await comme(admin, `select code from paquets_odf($1)`, [A.po.id]))[0].code;
  const compat = (await comme(admin, `select line_id from lignes_compatibles_paquet($1)`, [code])).map((x) => x.line_id);
  assert.ok(compat.includes(B.line.id));
  const r = (await comme(admin, `select reorienter_paquet($1,$2,$3::jsonb,'ODF annulé, pièces reprises pour B') r`, [code, B.line.id, JSON.stringify({ [M]: 20 })]))[0].r;
  const enfant = await one(`select production_order_id from article_lots where code=$1`, [r.code]);
  assert.equal(enfant.production_order_id, B.po.id);
  const reste = await comme(admin, `select composition_taille from paquets_odf($1)`, [A.po.id]);
  assert.deepEqual(reste[0].composition_taille, { [M]: 40 });
});

await test("ODF terminé : le devis ne s'annule plus", async () => {
  const DC = await devis("DEV-ANN-C");
  const C = await odf(5, DC.quote);
  await as(null);
  await q(`update production_orders set status='terminee' where id=$1`, [C.po.id]);
  await expectFail(() => comme(admin, `select annuler_devis($1,'trop tard')`, [DC.quote]), /est terminé : le devis DEV-ANN-C ne peut plus être annulé/);
  assert.equal((await one(`select status from quotes where id=$1`, [DC.quote])).status, "accepte");
});

await test("devis en brouillon sans ODF ; demande gardée si un autre devis est en cours", async () => {
  const DD = await devis("DEV-ANN-D", "brouillon");
  await as(null);
  await q(`insert into quotes(reference, request_id, company_id, status, total_amount) values ('DEV-ANN-D2',$1,$2,'envoye',500)`, [DD.request, company]);
  const r = (await comme(admin, `select annuler_devis($1,'Doublon') r`, [DD.quote]))[0].r;
  assert.deepEqual(r, { odf: [], demande_rouverte: false });
  assert.equal((await one(`select status from requests where id=$1`, [DD.request])).status, "acceptee");
});

await test("coupe : le matelas regroupé se clôture quand l'ODF d'un article est annulé avant la coupe", async () => {
  const DE = await devis("DEV-ANN-E");
  const E = await odf(10, DE.quote);
  const F = await odf(10);
  await q(`update production_order_lines set couleur_unique_id=(select couleur_unique_id from production_order_lines where id=$1) where id=$2`, [E.line.id, F.line.id]);
  const fe = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ('OT-ANN-E',true,'Manche annul') returning id`);
  for (const o of [E, F]) await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fe.id, o.line.id]);
  const te = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-ANN-E-T1') returning id`, [fe.id]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,4)`, [te.id, manche.id, M]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,5),($1,$3,5)`, [te.id, E.line.id, F.line.id]);
  await q(`select valider_trace($1,'marge')`, [te.id]);
  for (const o of [E, F]) {
    await q(`select submit_production_order($1)`, [o.po.id]);
    await q(`select validate_production_order($1)`, [o.po.id]);
  }
  await comme(admin, `select annuler_devis($1,'Commande annulée avant la coupe')`, [DE.quote]);
  await as(admin);
  await one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,15,1,null) r`, [te.id, JSON.stringify([
    { line_id: E.line.id, couches_reelles: 5, obtenus: { [manche.id]: { [M]: 20 } } },
    { line_id: F.line.id, couches_reelles: 5, obtenus: { [manche.id]: { [M]: 20 } } },
  ])]);
  const pe = await comme(admin, `select composition_taille from paquets_odf($1)`, [E.po.id]);
  assert.deepEqual(pe.map((x) => x.composition_taille), [{ [M]: 20 }]);
  assert.equal((await one(`select statut from traces_placement where id=$1`, [te.id])).statut, "termine");
});

console.log("Annulation devis + ODF : tous les tests passent");
