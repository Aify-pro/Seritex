// Scénarios SQL du rapport de production (migration 0145) : rapport figé à
// la demande de clôture, numéroté, décision de la direction (validée,
// renvoyée, clôture forcée), visibilité des données de valeur.
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
const chef = await mkUser("responsable_production");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client rapport') returning id`)).id;
await as(admin);

async function lance(sizes) {
  await as(admin);
  const o = await makeOdf(ctx, { admin, company, sections: [], sizes });
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1`, [o.line.id]);
  return { ...o, fin };
}
const rapports = (poId) => q(`select * from production_reports where production_order_id=$1 order by numero`, [poId]);

let o;
await test("demande de clôture : rapport n°1 figé (bilan, section, tissu, déchets), données de valeur à part", async () => {
  o = await lance({ [M]: 10 });
  await q(`select declare_production($1,$2,'premier_choix',8)`, [o.fin.id, M]);
  await q(`select declare_production($1,$2,'deuxieme_choix',1)`, [o.fin.id, M]);
  await q(`select declare_production($1,$2,'dechet',1)`, [o.fin.id, M]);
  await q(`insert into pesees(type, poids_kg, production_order_id) values ('reception_tissu',3.2,$1),('retour_stock',0.4,$1)`, [o.po.id]);
  const sac = await one(`insert into sacs_dechets(code) values ('SAC-R1') returning id`);
  await q(`insert into sacs_dechets_pesees(sac_id, poids_releve_kg, delta_kg, production_order_id) values ($1,0.3,0.3,$2)`, [sac.id, o.po.id]);
  await q(`select request_closure($1,null)`, [o.po.id]);

  const [r] = await rapports(o.po.id);
  assert.equal(r.numero, 1);
  assert.equal(r.decision, null);
  const c = r.contenu;
  const t = c.bilan.lignes[0].tailles[0];
  assert.deepEqual([t.demande, t.premier_choix, t.deuxieme_choix, t.dechets, t.en_cours], [10, 8, 1, 1, 0]);
  assert.equal(c.sections.length, 1);
  const s = c.sections[0];
  assert.deepEqual([s.categorie, s.premier_choix, s.deuxieme_choix, s.dechets], ["finition", 8, 1, 1]);
  assert.ok(s.premiere_declaration && s.derniere_declaration && s.duree_ecoulee_min >= 0);
  assert.deepEqual([Number(c.tissu.kg_reception), Number(c.tissu.kg_retour_stock), Number(c.tissu.kg_dechets)], [3.2, 0.4, 0.3]);
  const couts = await one(`select contenu from production_report_couts where report_id=$1`, [r.id]);
  assert.ok("prix_tissu_kg" in couts.contenu && Array.isArray(couts.contenu.theorique));
});

await test("figé : une déclaration après la demande ne change pas le rapport", async () => {
  await q(`insert into pesees(type, poids_kg, production_order_id) values ('reception_tissu',5,$1)`, [o.po.id]);
  const [r] = await rapports(o.po.id);
  assert.equal(Number(r.contenu.tissu.kg_reception), 3.2);
});

await test("renvoi en production : décision « renvoyée » avec le motif ; nouvelle demande = rapport n°2 ; validation", async () => {
  await q(`select confirm_closure($1,false,'recompter les 2e choix')`, [o.po.id]);
  let rs = await rapports(o.po.id);
  assert.deepEqual([rs[0].decision, rs[0].decision_note], ["renvoyee", "recompter les 2e choix"]);
  assert.ok(rs[0].decision_le && rs[0].decision_par);
  await q(`select request_closure($1,null)`, [o.po.id]);
  await q(`select confirm_closure($1,true,'conforme')`, [o.po.id]);
  rs = await rapports(o.po.id);
  assert.deepEqual(rs.map((r) => [r.numero, r.decision]), [[1, "renvoyee"], [2, "validee"]]);
  assert.equal(Number(rs[1].contenu.tissu.kg_reception), 8.2); // le n°2 voit la pesée ajoutée
});

await test("clôture exceptionnelle sans demande : un rapport est généré, décision « clôture forcée »", async () => {
  const f = await lance({ [M]: 5 });
  await q(`select declare_production($1,$2,'premier_choix',3)`, [f.fin.id, M]);
  await q(`select force_close_production_order($1,'commande annulée par le client')`, [f.po.id]);
  const rs = await rapports(f.po.id);
  assert.deepEqual(rs.map((r) => [r.numero, r.decision, r.decision_note]), [[1, "cloture_forcee", "commande annulée par le client"]]);
  assert.equal(rs[0].contenu.bilan.lignes[0].tailles[0].en_cours, 2);
});

await test("droits : lecture comme l'ODF, valeur réservée à tarification/voir, aucune écriture directe", async () => {
  const [r] = await rapports(o.po.id);
  const vus = await asAuth(chef, `select id from production_reports where id=$1`, [r.id]);
  assert.equal(vus.length, 1);
  const voitCouts = (await asAuth(chef, `select has_permission('tarification','view') v`))[0].v;
  const couts = await asAuth(chef, `select report_id from production_report_couts where report_id=$1`, [r.id]);
  assert.equal(couts.length, voitCouts ? 1 : 0);
  assert.equal((await asAuth(admin, `select report_id from production_report_couts where report_id=$1`, [r.id])).length, 1);
  await expectFail(() => asAuth(admin, `insert into production_reports(production_order_id, numero, contenu) values ($1,9,'{}')`, [o.po.id]), /permission denied|row-level security/);
  await expectFail(() => asAuth(admin, `update production_reports set decision='validee' where id=$1`, [r.id]), /permission denied|row-level security/);
});

await test("le rapport ne bloque jamais la clôture : sans session, le statut passe et le rapport est fait sans bilan", async () => {
  const s = await lance({ [M]: 4 });
  await as(null);
  await q(`update production_orders set status='demande_cloture' where id=$1`, [s.po.id]);
  assert.equal((await one(`select status::text s from production_orders where id=$1`, [s.po.id])).s, "demande_cloture");
  const rs = await rapports(s.po.id);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].contenu.bilan.indisponible, true);
  await as(admin);
});

console.log("Rapport de production : tous les tests passent");
