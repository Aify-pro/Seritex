// Scénarios SQL du lot LIV-2 (migration 0079) : photo de décharge exigée,
// confirmation de réception par jeton (haché), litige, tournées.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const compta = await mkUser("comptabilite");
const livreur = await mkUser("livreur");
const autreLivreur = await mkUser("livreur");
const rl = await mkUser("responsable_livraison");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client') returning id`)).id;
await as(admin);
const lieu = await one(`insert into delivery_places(company_id, libelle, par_defaut) values ($1,'Siège',true) returning id`, [company]);

async function shipmentReady() {
  await as(admin);
  const odf = await makeOdf(ctx, { admin, company, sections: [], sizes: { [M]: 10 } });
  await q(`select submit_production_order($1)`, [odf.po.id]);
  await q(`select validate_production_order($1)`, [odf.po.id]);
  const fin = await one(`select id from work_orders where production_order_line_id=$1`, [odf.line.id]);
  await q(`select declare_production($1,$2,'premier_choix',10)`, [fin.id, M]);
  const s = await one(`select id from shipments where production_order_id=$1`, [odf.po.id]);
  await as(rl);
  await q(`select prepare_shipment($1,$2,'livraison')`, [s.id, lieu.id]);
  await as(compta);
  await q(`select validate_shipment_accounting($1,'a_terme')`, [s.id]);
  return s;
}

let s, round;
await test("tournée : composition par le service livraison, livreur et date reportés", async () => {
  s = await shipmentReady();
  await as(rl);
  round = await one(`insert into delivery_rounds(date, livreur_id) values (current_date, $1) returning id`, [livreur]);
  await q(`select add_round_stop($1,$2)`, [round.id, s.id]);
  const sh = await one(`select statut, livreur_id, date_planifiee is not null d from shipments where id=$1`, [s.id]);
  assert.deepEqual([sh.statut, sh.livreur_id, sh.d], ["planifiee", livreur, true]);
});

await test("« livrée » exige la photo du BL signé", async () => {
  await as(livreur);
  await q(`select set_shipment_status($1,'en_route')`, [s.id]);
  await expectFail(() => q(`select set_shipment_status($1,'livree')`, [s.id]), /photo du BL signé/);
  await expectFail(() => q(`select record_shipment_document($1,'decharge_bl','autre/chemin.jpg')`, [s.id]), /chemin/);
  await as(autreLivreur);
  await expectFail(() => q(`select record_shipment_document($1,'decharge_bl',$2)`, [s.id, `expeditions/${s.id}/x.jpg`]), /pas confiée/);
  await as(livreur);
  await q(`select record_shipment_document($1,'decharge_bl',$2, 5.3, -4.0)`, [s.id, `expeditions/${s.id}/bl.jpg`]);
  await q(`select set_shipment_status($1,'livree',null,5.3,-4.0)`, [s.id]);
});

let token;
await test("confirmation : jeton haché, page publique, réponse horodatée", async () => {
  await as(livreur);
  token = (await one(`select create_shipment_confirmation($1) t`, [s.id])).t;
  assert.match(token, /^[0-9a-f]{48}$/);
  const stored = await one(`select token_hash from shipment_confirmations where shipment_id=$1`, [s.id]);
  assert.notEqual(stored.token_hash, token);
  await as(null);
  await db.exec("set role anon");
  try {
    const info = (await db.query(`select * from shipment_confirmation_info($1)`, [token])).rows[0];
    assert.equal(info.pieces, 10);
    assert.equal((await db.query(`select answer_shipment_confirmation($1,'confirme') r`, [token])).rows[0].r, "reception_confirmee");
    await expectFail(() => db.query(`select answer_shipment_confirmation($1,'confirme')`, [token]), /déjà reçu/);
    await expectFail(() => db.query(`select answer_shipment_confirmation('faux','confirme')`), /invalide/);
    await expectFail(() => db.query(`select count(*) from shipments`), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
  const ev = await one(`select statut, source from shipment_events where shipment_id=$1 order by occurred_at desc limit 1`, [s.id]);
  assert.deepEqual([ev.statut, ev.source], ["reception_confirmee", "client"]);
});

await test("signaler un problème : passe en litige", async () => {
  const s2 = await shipmentReady();
  await as(rl);
  await q(`select plan_shipment($1,null,null,$2,current_date)`, [s2.id, livreur]);
  await as(livreur);
  await q(`select set_shipment_status($1,'en_route')`, [s2.id]);
  await q(`select record_shipment_document($1,'decharge_bl',$2)`, [s2.id, `expeditions/${s2.id}/bl.jpg`]);
  await q(`select set_shipment_status($1,'livree')`, [s2.id]);
  const t = (await one(`select create_shipment_confirmation($1) t`, [s2.id])).t;
  await expectFail(() => q(`select answer_shipment_confirmation($1,'probleme')`, [t]), /décrivez/);
  assert.equal((await one(`select answer_shipment_confirmation($1,'probleme','2 cartons manquants') r`, [t])).r, "litige");
  assert.equal((await one(`select statut from shipments where id=$1`, [s2.id])).statut, "litige");
});
console.log("LIV-2 : tous les tests passent");
