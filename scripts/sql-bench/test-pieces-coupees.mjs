// Scénarios SQL des pièces coupées par semi-fini (migration 0146) : figées à
// la clôture du matelas — coupé = pièces reconnues sur le tracé × couches
// réelles, attendu = t-shirts obtenus × nomenclature ; pièces non rattachées
// et non reconnues comptées à part ; jamais bloquant ; rapport de production.
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
const company = (await one(`insert into companies(name) values ('Client coupe') returning id`)).id;
await as(admin);

// Semi-finis et leurs patrons (taille M) ; un ancien patron de produit fini (non rattaché).
const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id, code`);
const col = await one(`insert into product_models(name, nature) values ('Col rond','semi_fini') returning id`);
async function piece(modelId, code, nom) {
  const pa = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ($1,$2,$3) returning id`, [code, nom, modelId]);
  const p = await one(`insert into patterns(article_id, size) values ($1,'M') returning id`, [pa.id]);
  return one(`insert into pattern_pieces(pattern_id, name, expected_count, area, perimeter, radial_signature, points) values ($1,$2,1,1,1,'{}','[]') returning id`, [p.id, nom]);
}
const pManche = await piece(manche.id, 'MAN', 'Manche');
const pCol = await piece(col.id, 'COL', 'Col');
const ancien = await one(`insert into product_models(name, nature) values ('T-shirt ancien','pf') returning id`);
await q(`alter table pattern_articles disable trigger pattern_articles_semi_fini`);
const pPoche = await piece(ancien.id, 'POC', 'Poche');
await q(`alter table pattern_articles enable trigger pattern_articles_semi_fini`);

const o = await makeOdf(ctx, { admin, company, sections: ["Sérigraphie"], sizes: { [M]: 20 } });
await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','Manche gauche'),($1,'md','Manche droite')`, [o.model.id]);
await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md'),($1,'',1,'',$3,null)`, [o.model.id, manche.id, col.id]);
await q(`select submit_production_order($1)`, [o.po.id]);
await q(`select validate_production_order($1)`, [o.po.id]);
// Le déclencheur ne dépend pas de la section : l'événement de matelas est posé comme en SF-5.
const woCoupe = await one(`select id from work_orders where production_order_line_id=$1 and section_id=(select id from sections where name='Sérigraphie')`, [o.line.id]);
const fiche = await one(`insert into fiches_placement(numero_ot, product_model_id, production_order_line_id) values ('OT-PC-1',$1,$2) returning id`, [o.model.id, o.line.id]);

async function matelas(ref, reconnus, nonReconnues, couches, obtenus) {
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,(select coalesce(max(ordre),0)+1 from traces_placement where fiche_id=$1),$2,'{"Homme/M":2}') returning id`, [fiche.id, ref]);
  await q(`insert into analyses_trace(trace_id, nb_pieces_detectees, patrons_reconnus, pieces_non_reconnues, taux_reconnaissance, reconnaissance_complete) values ($1,0,$2::jsonb,$3::jsonb,1,true)`,
    [t.id, JSON.stringify(reconnus), JSON.stringify(Array.from({ length: nonReconnues }, (_, i) => ({ index_piece: i })))]);
  const ev = await one(`insert into work_order_events(work_order_id, event_type, trace_id, resultat, quantity, quantites_obtenues, nb_couches_reel) values ($1,'matelas_cloture',$2,'ok',$3,$4::jsonb,$5) returning id`,
    [woCoupe.id, t.id, obtenus, JSON.stringify({ [M]: obtenus }), couches]);
  return { trace: t, ev };
}
const rec = (p, quantite, nom) => ({ patron_id: p.id, article: "?", taille: "M", piece: nom, quantite, dont_en_miroir: 0 });

await test("clôture du matelas : coupé = tracé × couches, attendu = t-shirts × nomenclature, hors semi-fini à part", async () => {
  // Tracé de 2 t-shirts par couche : 4 manches, 1 seul col (oubli), 2 poches d'un ancien patron, 1 pièce inconnue.
  const { ev } = await matelas("OT-PC-1-T1", [rec(pManche, 4, "Manche"), rec(pCol, 1, "Col"), rec(pPoche, 2, "Poche")], 1, 10, 20);
  const rows = await q(`select source, statut, piece, taille, quantite_par_couche qpc, couches, quantite, semi_fini_id from pieces_coupees where work_order_event_id=$1 order by source, statut, piece`, [ev.id]);
  const vue = rows.map((r) => [r.source, r.statut, r.piece, r.quantite]);
  assert.deepEqual(vue, [
    ["nomenclature", "semi_fini", "Col rond", 20],
    ["nomenclature", "semi_fini", "Manche courte", 40],
    ["trace", "non_rattachee", "Poche", 20],
    ["trace", "non_reconnue", "Pièces non reconnues", 10],
    ["trace", "semi_fini", "Col", 10],
    ["trace", "semi_fini", "Manche", 40],
  ]);
  const m = rows.find((r) => r.piece === "Manche");
  assert.deepEqual([m.taille, m.qpc, m.couches, m.semi_fini_id], ["M", 4, 10, manche.id]);
});

await test("rapport de production : partie Semi-finis (coupé, attendu) et pièces hors semi-fini", async () => {
  const c = (await one(`select production_report_contenu($1, '{}'::jsonb) c`, [o.po.id])).c;
  const sf = Object.fromEntries(c.semi_finis.map((s) => [s.piece, [s.statut, s.coupe, s.attendu]]));
  assert.deepEqual(sf["Manche courte"], ["semi_fini", 40, 40]);
  assert.deepEqual(sf["Col rond"], ["semi_fini", 10, 20]);
  assert.deepEqual(sf["Poche"], ["non_rattachee", 20, null]);
  assert.deepEqual(sf["Pièces non reconnues"], ["non_reconnue", 10, null]);
  assert.ok("bilan" in c && "sections" in c && "tissu" in c && "consommables" in c);
});

await test("jamais bloquant : une analyse illisible n'empêche pas la clôture du matelas", async () => {
  const { ev } = await matelas("OT-PC-1-T2", [{ patron_id: "pas-un-uuid", quantite: 2 }], 0, 5, 10);
  assert.ok(ev.id);
  assert.equal((await one(`select count(*)::int n from pieces_coupees where work_order_event_id=$1`, [ev.id])).n, 0);
});

await test("sans analyse du tracé : seul l'attendu par la nomenclature est figé", async () => {
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,9,'OT-PC-1-T9') returning id`, [fiche.id]);
  const ev = await one(`insert into work_order_events(work_order_id, event_type, trace_id, resultat, quantity, nb_couches_reel) values ($1,'matelas_cloture',$2,'ok',6,3) returning id`, [woCoupe.id, t.id]);
  const rows = await q(`select source, quantite from pieces_coupees where work_order_event_id=$1 order by quantite`, [ev.id]);
  assert.deepEqual(rows.map((r) => [r.source, r.quantite]), [["nomenclature", 6], ["nomenclature", 12]]);
});

await test("droits : lecture comme l'ODF, aucune écriture directe", async () => {
  assert.ok((await asAuth(admin, `select id from pieces_coupees where production_order_id=$1`, [o.po.id])).length > 0);
  await expectFail(() => asAuth(admin, `insert into pieces_coupees(work_order_event_id, production_order_id, source, statut, piece, quantite) select work_order_event_id, production_order_id, 'trace','non_reconnue','x',1 from pieces_coupees limit 1`), /permission denied/);
  await expectFail(() => asAuth(admin, `update pieces_coupees set quantite=0`), /permission denied/);
});

console.log("Pièces coupées par semi-fini : tous les tests passent");
