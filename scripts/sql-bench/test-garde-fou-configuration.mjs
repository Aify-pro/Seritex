// Scénarios SQL de la migration 0166 : un article dont la configuration est
// incomplète bloque l'envoi du devis, son acceptation et la soumission de
// l'ODF ; la liste de ce qui manque est lisible par le personnel.
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
const company = (await one(`insert into companies(name) values ('Client garde-fou') returning id`)).id;
const blanc = (await one(`insert into colors(name, code) values ('ZBlanc','ZBL') returning id`)).id;
const bleu = (await one(`insert into colors(name, code) values ('ZBleu','ZBU') returning id`)).id;

// Modèle à deux zones (corps, manche) ; nomenclature : corps rattaché à sa zone, manche sans zone.
const model = await one(`insert into product_models(name) values ('T-shirt garde-fou') returning id`);
await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'corps','Corps'),($1,'manche','Manche')`, [model.id]);
const corps = await one(`insert into product_models(name, nature) values ('Corps GF','semi_fini') returning id`);
const manche = await one(`insert into product_models(name, nature) values ('Manche GF','semi_fini') returning id`);
await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'corps')`, [model.id, corps.id]);
const ligneManche = await one(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',2,'',$2) returning id`, [model.id, manche.id]);

// Devis en validation interne, une ligne colorée par zone, tailles complètes.
await as(null);
const request = (await one(`insert into requests(reference, company_id, status, description) values ('DEM-GF',$1,'devis_envoye','d') returning id`, [company])).id;
const quote = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ('DEV-GF',$1,$2,'en_validation_interne',1000) returning id`, [request, company])).id;
const ql = (await one(`insert into quote_lines(quote_id, product_model_id, description, quantity, unit_price) values ($1,$2,'T-shirt bicolore',10,100) returning id`, [quote, model.id])).id;
await q(`insert into quote_line_sizes(quote_line_id, taille, quantite) values ($1,$2,10)`, [ql, M]);
await q(`insert into quote_line_zone_colors(quote_line_id, zone_key, color_id) values ($1,'corps',$2)`, [ql, blanc]);

await test("devis : zone sans couleur et pièce sans zone listées pour le personnel", async () => {
  const r = await asAuth(admin, `select article, anomalie from configuration_devis($1)`, [quote]);
  const textes = r.map((x) => x.anomalie);
  assert.ok(textes.includes("couleur manquante pour la zone « Manche »"));
  assert.ok(textes.some((t) => t.startsWith("pièce « Manche GF » sans couleur")));
  assert.equal(r.length, 2);
});

await test("devis : l'envoi au client est refusé tant que la configuration est incomplète", async () => {
  await as(null);
  await expectFail(() => q(`update quotes set status='envoye' where id=$1`, [quote]), /Configuration incomplète, le devis ne peut pas être envoyé au client/);
  // Le devis reste modifiable : d'autres changements passent.
  await q(`update quotes set total_amount=1200 where id=$1`, [quote]);
});

await test("devis : la zone colorée et la pièce rattachée à une zone débloquent l'envoi", async () => {
  await q(`insert into quote_line_zone_colors(quote_line_id, zone_key, color_id) values ($1,'manche',$2)`, [ql, bleu]);
  await q(`update nomenclature_lines set zone_key='manche' where id=$1`, [ligneManche.id]);
  assert.equal((await asAuth(admin, `select count(*)::int n from configuration_devis($1)`, [quote]))[0].n, 0);
  await as(null);
  await q(`update quotes set status='envoye' where id=$1`, [quote]);
});

await test("devis : l'acceptation est refusée si la configuration redevient incomplète", async () => {
  await q(`update quote_line_sizes set quantite=8 where quote_line_id=$1`, [ql]);
  await expectFail(() => q(`update quotes set status='accepte' where id=$1`, [quote]), /ne peut pas être accepté.*répartition par taille totalise 8 pièces pour 10/);
  await q(`update quote_line_sizes set quantite=10 where quote_line_id=$1`, [ql]);
  await q(`update quotes set status='accepte' where id=$1`, [quote]);
});

await test("couleur unique : aucune exigence de zone ni de pièce", async () => {
  await q(`update nomenclature_lines set zone_key=null where id=$1`, [ligneManche.id]);
  const ql2 = (await one(`insert into quote_lines(quote_id, product_model_id, description, quantity, unit_price, couleur_unique_id) values ($1,$2,'T-shirt uni',5,100,$3) returning id`, [quote, model.id, blanc])).id;
  await q(`insert into quote_line_sizes(quote_line_id, taille, quantite) values ($1,$2,5)`, [ql2, M]);
  const r = await asAuth(admin, `select article from configuration_devis($1)`, [quote]);
  assert.ok(!r.some((x) => x.article === "T-shirt uni"));
});

await test("ODF : la soumission est refusée pour une pièce sans couleur ; la liste est lisible", async () => {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 10 }, couleur: false });
  await q(`update production_order_lines set product_model_id=$1 where id=$2`, [model.id, o.line.id]);
  await q(`insert into production_order_line_zone_colors(production_order_line_id, zone_key, color_id) values ($1,'corps',$2),($1,'manche',$3)`, [o.line.id, blanc, bleu]);
  const r = await asAuth(admin, `select anomalie from configuration_odf($1)`, [o.po.id]);
  assert.deepEqual(r.map((x) => x.anomalie.slice(0, 24)), ["pièce « Manche GF » sans"]);
  await as(null);
  await expectFail(() => q(`update production_orders set status='en_attente_validation' where id=$1`, [o.po.id]), /l'ordre de fabrication ne peut pas être soumis — T-shirt blanc : pièce « Manche GF »/);
  await q(`update nomenclature_lines set couleur_imposee_id=$1 where id=$2`, [bleu, ligneManche.id]);
  assert.equal((await asAuth(admin, `select count(*)::int n from configuration_odf($1)`, [o.po.id]))[0].n, 0);
});

await test("droits : les fonctions internes sont fermées, la lecture réservée au personnel", async () => {
  await expectFail(() => asAuth(admin, `select * from anomalies_configuration_ligne_devis($1)`, [ql]), /permission denied/);
  const client = await mkUser("client", { company_id: company });
  assert.equal((await asAuth(client, `select count(*)::int n from configuration_devis($1)`, [quote]))[0].n, 0);
});

console.log("Garde-fou de configuration : tous les tests passent");
