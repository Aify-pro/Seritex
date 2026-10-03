// Scénarios SQL du lot LIV-1 (migration 0078) : entrée automatique en
// livraison au 1er choix, plafond, BL numéroté, validation comptable
// bloquante, retrait sur place, scission et regroupement.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const compta = await mkUser("comptabilite");
const livreur = await mkUser("livreur");
const rl = await mkUser("responsable_livraison");
const M = "Homme/M", L = "Homme/L";
const company = (await one(`insert into companies(name) values ('Client BL') returning id`)).id;
await as(admin);
const lieu = await one(`insert into delivery_places(company_id, libelle, par_defaut, repere) values ($1,'Siège',true,'Face pharmacie') returning id`, [company]);

async function launched(sizes) {
  await as(admin);
  const odf = await makeOdf(ctx, { admin, company, sections: [], sizes });
  await q(`select submit_production_order($1)`, [odf.po.id]);
  await q(`select validate_production_order($1)`, [odf.po.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1`, [odf.line.id]);
  return { ...odf, fin };
}

let o, ship;
await test("50 pièces de 1er choix en finition = 50 pièces « à préparer », sans action", async () => {
  o = await launched({ [M]: 60, [L]: 10 });
  await q(`select declare_production($1,$2,'premier_choix',50)`, [o.fin.id, M]);
  await q(`select declare_production($1,$2,'deuxieme_choix',2)`, [o.fin.id, M]);
  ship = await one(`select * from shipments where production_order_id=$1`, [o.po.id]);
  assert.equal(ship.statut, "a_preparer");
  assert.equal(ship.delivery_place_id, lieu.id);
  const l = await q(`select taille, quantite from shipment_lines where shipment_id=$1`, [ship.id]);
  assert.deepEqual(l.map((r) => [r.taille, r.quantite]), [[M, 50]]);
  await q(`select declare_production($1,$2,'premier_choix',5)`, [o.fin.id, M]);
  assert.equal((await one(`select quantite from shipment_lines where shipment_id=$1`, [ship.id])).quantite, 55);
});

await test("on ne peut pas expédier plus que le 1er choix", async () => {
  await as(rl);
  await expectFail(() => q(`select set_shipment_line_quantity($1,$2,$3,56)`, [ship.id, o.line.id, M]), /plus que le 1er choix/);
  await expectFail(() => q(`select set_shipment_line_quantity($1,$2,$3,1)`, [ship.id, o.line.id, L]), /plus que le 1er choix/);
});

await test("correction du 1er choix : retirée de l'expédition à préparer", async () => {
  await as(admin);
  const d = await one(`select id from production_declarations where type='premier_choix' and production_order_line_id=$1 order by created_at desc limit 1`, [o.line.id]);
  await q(`select correct_declaration($1, 5, 'erreur')`, [d.id]);
  assert.equal((await one(`select quantite from shipment_lines where shipment_id=$1`, [ship.id])).quantite, 50);
});

await test("pas de départ sans validation de la comptabilité", async () => {
  await as(rl);
  const ref = (await one(`select prepare_shipment($1,$2,'livraison') r`, [ship.id, lieu.id])).r;
  assert.match(ref, /^BL-\d{4}-0001$/);
  const s = await one(`select lieu_libelle, lieu_repere, statut from shipments where id=$1`, [ship.id]);
  assert.deepEqual([s.lieu_libelle, s.lieu_repere, s.statut], ["Siège", "Face pharmacie", "preparee"]);
  await expectFail(() => q(`select plan_shipment($1,null,null,$2,current_date)`, [ship.id, livreur]), /validée par la comptabilité/);
  await expectFail(() => q(`select validate_shipment_accounting($1,'regle')`, [ship.id]), /réservée à la comptabilité/);
  await as(compta);
  await expectFail(() => q(`select validate_shipment_accounting($1,'a_encaisser')`, [ship.id]), /montant/);
  await q(`select validate_shipment_accounting($1,'a_encaisser',125000)`, [ship.id]);
  await as(rl);
  await q(`select plan_shipment($1,null,null,$2,current_date)`, [ship.id, livreur]);
});

await test("le livreur : en route puis livrée ; il voit le lieu", async () => {
  await as(livreur);
  await q(`select set_shipment_status($1,'en_route')`, [ship.id]);
  await q(`select set_shipment_status($1,'livree',null,5.33,-4.02,'M. Koné')`, [ship.id]);
  const s = await one(`select statut, receptionnaire_nom from shipments where id=$1`, [ship.id]);
  assert.deepEqual([s.statut, s.receptionnaire_nom], ["livree", "M. Koné"]);
  assert.equal((await one(`select livreur_voit_lieu($1) v`, [lieu.id])).v, true);
  const ev = await q(`select statut, source from shipment_events where shipment_id=$1 order by occurred_at`, [ship.id]);
  assert.ok(ev.some((e) => e.statut === "livree" && e.source === "livreur"));
  const sum = (await one(`select production_order_delivery_summary($1) s`, [o.po.id])).s;
  assert.equal(sum.etat, "partiel");
  assert.equal(sum.livre, 50);
});

await test("retrait sur place : prête à enlever puis enlevée (signature)", async () => {
  const r = await launched({ [M]: 10 });
  await as(admin);
  await q(`select declare_production($1,$2,'premier_choix',10)`, [r.fin.id, M]);
  const s = await one(`select id from shipments where production_order_id=$1`, [r.po.id]);
  await as(rl);
  await q(`select prepare_shipment($1,null,'retrait')`, [s.id]);
  await as(compta);
  await q(`select validate_shipment_accounting($1,'regle')`, [s.id]);
  await as(rl);
  await expectFail(() => q(`select plan_shipment($1,null,null,$2,current_date)`, [s.id, livreur]), /retrait/);
  await q(`select mark_ready_for_pickup($1)`, [s.id]);
  await expectFail(() => q(`select set_shipment_status($1,'enlevee')`, [s.id]), /nom de la personne/);
  await q(`select set_shipment_status($1,'enlevee',null,null,null,'Mme Traoré')`, [s.id]);
  assert.equal((await one(`select production_order_delivery_summary($1) s`, [r.po.id])).s.etat, "livre");
});

await test("un ODF sans client ne crée aucune expédition", async () => {
  const fn = await one(`select prosrc from pg_proc where proname='enqueue_for_delivery'`);
  assert.match(fn.prosrc, /company_id is null/);
});

await test("scission puis regroupement (même client)", async () => {
  const s = await launched({ [M]: 20 });
  await as(admin);
  await q(`select declare_production($1,$2,'premier_choix',20)`, [s.fin.id, M]);
  const a = await one(`select id from shipments where production_order_id=$1`, [s.po.id]);
  await as(rl);
  const b = (await one(`select split_shipment($1,$2::jsonb) id`, [a.id, JSON.stringify([{ line_id: s.line.id, taille: M, quantite: 8 }])])).id;
  assert.equal((await one(`select quantite from shipment_lines where shipment_id=$1`, [a.id])).quantite, 12);
  assert.equal((await one(`select quantite from shipment_lines where shipment_id=$1`, [b])).quantite, 8);
  await q(`select merge_shipments($1,$2)`, [a.id, b]);
  assert.equal((await one(`select quantite from shipment_lines where shipment_id=$1`, [a.id])).quantite, 20);
  assert.equal((await one(`select statut from shipments where id=$1`, [b])).statut, "annulee");
  const autre = (await one(`insert into companies(name) values ('Autre') returning id`)).id;
  await as(admin);
  const x = await one(`insert into shipments(company_id) values ($1) returning id`, [autre]);
  await as(rl);
  await expectFail(() => q(`select merge_shipments($1,$2)`, [a.id, x.id]), /même client/);
});
console.log("LIV-1 : tous les tests passent");
