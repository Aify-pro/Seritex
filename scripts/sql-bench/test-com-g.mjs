// Scénarios SQL du lot COM-G (migration 0087) : référentiel des consommables,
// nomenclature reliée, consommation théorique à la demande de clôture,
// ajustement motivé, sorties de stock à la clôture.
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
const commercial = await mkUser("commercial");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client conso') returning id`)).id;
await as(admin);

const fam = await one(`select id from consumable_families where code_court='BO'`);
const emb = await one(`select id from consumable_families where code_court='EM'`);
let bouton, sachet;
await test("code COBO0001, COBO0002… par famille, figé", async () => {
  bouton = await one(`insert into consumables(designation, famille_id, sage_reference) values ('Bouton 12 mm',$1,'BTN12') returning *`, [fam.id]);
  const b2 = await one(`insert into consumables(designation, famille_id) values ('Bouton 15 mm',$1) returning code`, [fam.id]);
  sachet = await one(`insert into consumables(designation, famille_id, nature, etape) values ('Sachet',$1,'consommable','finition') returning *`, [emb.id]);
  assert.deepEqual([bouton.code, b2.code, sachet.code], ["COBO0001", "COBO0002", "COEM0001"]);
  await expectFail(() => q(`update consumables set code='X' where id=$1`, [bouton.id]), /figé/);
  await expectFail(() => asAuth(commercial, `insert into consumables(designation, famille_id) values ('x',$1)`, [fam.id]), /row-level security/);
  await as(admin);
});

let o;
await test("consommation théorique à la demande de clôture = nomenclature × pièces finies", async () => {
  o = await makeOdf(ctx, { admin, company, sections: [], sizes: { [M]: 10 } });
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, consumable_id) values ($1,'Bouton',4,'piece',$2),($1,'Sachet',1,'piece',$3),($1,'Libre',2,'piece',null)`, [o.model.id, bouton.id, sachet.id]);
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1`, [o.line.id]);
  await q(`select declare_production($1,$2,'premier_choix',8)`, [fin.id, M]);
  await q(`select declare_production($1,$2,'deuxieme_choix',1)`, [fin.id, M]);
  await q(`select declare_production($1,$2,'dechet',1)`, [fin.id, M]);
  await q(`select request_closure($1,null)`, [o.po.id]);
  const rows = await q(`select k.code, c.pieces, c.quantite_theorique::numeric q from production_order_consumptions c join consumables k on k.id=c.consumable_id where c.production_order_id=$1 order by k.code`, [o.po.id]);
  assert.deepEqual(rows.map((r) => [r.code, r.pieces, Number(r.q)]), [["COBO0001", 9, 36], ["COEM0001", 9, 9]]);
});

await test("ajustement : motif exigé hors théorique ; sorties à la clôture, puis plus d'ajustement", async () => {
  const c = await one(`select c.id from production_order_consumptions c where c.consumable_id=$1 and c.production_order_id=$2`, [bouton.id, o.po.id]);
  await expectFail(() => q(`select set_order_consumption($1,40,null)`, [c.id]), /motif est obligatoire/);
  await q(`select set_order_consumption($1,40,'boutons cassés')`, [c.id]);
  await q(`select confirm_closure($1,true)`, [o.po.id]);
  const mv = await q(`select type, article_ref, quantite_ou_poids::numeric q from stock_movements where production_order_id=$1 and consumable_id is not null order by article_ref`, [o.po.id]);
  assert.deepEqual(mv.map((m) => [m.type, m.article_ref, Number(m.q)]), [["sortie_consommable", "BTN12", 40], ["sortie_consommable", "COEM0001", 9]]);
  await expectFail(() => q(`select set_order_consumption($1,41,'x')`, [c.id]), /ne s'ajuste/);
});

console.log("COM-G : tous les tests passent");
