// Scénarios SQL des surplus de production (migration 0091, retour de
// recette C2) : un atelier déclare plus que reçu avec un motif ; le surplus
// suit le circuit et apparaît au bilan.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client surplus') returning id`)).id;
await q(`insert into sections(name, display_order, categorie_id) values ('Couture A', 3, (select id from atelier_categories where cle='couture')) on conflict do nothing`);
await as(admin);
const o = await makeOdf(ctx, { admin, company, sections: ["Couture A"], sizes: { [M]: 10 } });
await q(`select submit_production_order($1)`, [o.po.id]);
await q(`select validate_production_order($1)`, [o.po.id]);
const couture = await one(`select id from work_orders where production_order_line_id=$1 and etape=1`, [o.line.id]);
const fin = await one(`select id from work_orders where production_order_line_id=$1 and etape=2`, [o.line.id]);

await test("au-delà du reçu sans motif : refus explicite", async () => {
  await expectFail(() => q(`select declare_production($1,$2,'bonne',12)`, [couture.id, M]), /indiquez un motif pour déclarer un surplus/);
});

await test("avec motif : 2 pièces en surplus, la couture sort 12 pièces", async () => {
  await q(`select declare_production($1,$2,'bonne',12,'défaut tissu, pièces refaites')`, [couture.id, M]);
  const s = await one(`select quantite, motif from production_declarations where type='surplus' and work_order_id=$1`, [couture.id]);
  assert.deepEqual([s.quantite, s.motif], [2, "défaut tissu, pièces refaites"]);
  const f = await q(`select etape, entree, bonnes, en_cours from line_stage_flow($1) order by etape`, [o.line.id]);
  assert.deepEqual(f.map((r) => [r.etape, r.entree, r.bonnes, r.en_cours]), [[1, 12, 12, 0], [2, 12, 0, 12]]);
});

await test("le surplus suit le circuit jusqu'à la finition et au bilan", async () => {
  await q(`select declare_production($1,$2,'premier_choix',12)`, [fin.id, M]);
  const b = (await one(`select production_order_balance($1) b`, [o.po.id])).b;
  const t = b.lignes[0].tailles[0];
  assert.deepEqual([t.demande, t.premier_choix, t.surplus, t.en_cours], [10, 12, 2, 0]);
  // Expédition : les 12 pièces de 1er choix.
  assert.equal((await one(`select sum(quantite)::int q from shipment_lines where production_order_line_id=$1`, [o.line.id])).q, 12);
});

console.log("Surplus : tous les tests passent");
