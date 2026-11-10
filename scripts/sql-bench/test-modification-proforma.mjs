// Scénarios SQL de la migration 0167 : l'administrateur modifie une proforma
// acceptée tant que son ODF est en brouillon ; la modification est reportée
// sur l'ODF, avec motif et trace.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

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
const commercial = await mkUser("commercial");
const M = "Homme/M";
const L = "Homme/L";
const company = (await one(`insert into companies(name) values ('Client modif') returning id`)).id;
const blanc = (await one(`insert into colors(name, code) values ('MBlanc','MBL') returning id`)).id;
const noir = (await one(`insert into colors(name, code) values ('MNoir','MNO') returning id`)).id;
const model = (await one(`insert into product_models(name) values ('T-shirt modif') returning id`)).id;

// Devis envoyé, une ligne en couleur unique, puis accepté : l'ODF naît en brouillon.
async function devisAccepte(ref) {
  await as(null);
  const request = (await one(`insert into requests(reference, company_id, status, description) values ($1,$2,'devis_envoye','d') returning id`, [`DEM-${ref}`, company])).id;
  const quote = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ($1,$2,$3,'envoye',1000) returning id`, [ref, request, company])).id;
  const line = (await one(`insert into quote_lines(quote_id, product_model_id, description, quantity, unit_price, couleur_unique_id) values ($1,$2,'T-shirt blanc',10,100,$3) returning id`, [quote, model, blanc])).id;
  await q(`insert into quote_line_sizes(quote_line_id, taille, quantite) values ($1,$2,10)`, [line, M]);
  const po = (await comme(admin, `select accept_quote($1) as id`, [quote]))[0].id;
  return { quote, line, po };
}

const A = await devisAccepte("DEV-MOD-A");

await test("ouvrir : administrateur seul, motif obligatoire", async () => {
  await expectFail(() => comme(commercial, `select ouvrir_modification_devis($1,'motif')`, [A.quote]), /seul l'administrateur/);
  await expectFail(() => comme(admin, `select ouvrir_modification_devis($1,'  ')`, [A.quote]), /motif de la modification est obligatoire/);
  await comme(admin, `select ouvrir_modification_devis($1,'Le client passe à 15 pièces et ajoute un modèle noir')`, [A.quote]);
  const d = await one(`select modification_ouverte_le is not null o, modification_motif m from quotes where id=$1`, [A.quote]);
  assert.deepEqual([d.o, d.m], [true, "Le client passe à 15 pièces et ajoute un modèle noir"]);
});

await test("pendant la modification : l'ODF ne peut pas être soumis", async () => {
  await as(null);
  await expectFail(() => q(`update production_orders set status='en_attente_validation' where id=$1`, [A.po]), /proforma de cet ODF est en cours de modification/);
});

await test("pendant la modification : répartition modifiable par l'administrateur, pas par le commercial", async () => {
  await q(`update quote_lines set quantity=15 where id=$1`, [A.line]);
  await expectFail(() => comme(commercial, `select set_quote_line_sizes($1,$2)`, [A.line, { [M]: 10, [L]: 5 }]), /seul l'administrateur/);
  await comme(admin, `select set_quote_line_sizes($1,$2)`, [A.line, { [M]: 10, [L]: 5 }]);
});

let nouvelle;
await test("appliquer : l'ODF reprend quantité, tailles, couleur et le nouvel article", async () => {
  nouvelle = (await one(`insert into quote_lines(quote_id, product_model_id, description, quantity, unit_price, couleur_unique_id) values ($1,$2,'T-shirt noir',5,100,$3) returning id`, [A.quote, model, noir])).id;
  await q(`insert into quote_line_sizes(quote_line_id, taille, quantite) values ($1,$2,5)`, [nouvelle, M]);
  const po = (await comme(admin, `select appliquer_modification_devis($1) as id`, [A.quote]))[0].id;
  assert.equal(po, A.po);
  const lignes = await q(`select description, quantity, couleur_unique_id from production_order_lines where production_order_id=$1 order by description`, [A.po]);
  assert.deepEqual(lignes.map((l) => [l.description, l.quantity, l.couleur_unique_id]), [["T-shirt blanc", 15, blanc], ["T-shirt noir", 5, noir]]);
  const tailles = await q(`select taille, quantite_demandee from production_order_sizes s join production_order_lines l on l.id=s.production_order_line_id where l.quote_line_id=$1 order by taille`, [A.line]);
  assert.deepEqual(tailles.map((t) => [t.taille, t.quantite_demandee]), [[L, 5], [M, 10]]);
  assert.equal((await one(`select total_quantity from production_orders where id=$1`, [A.po])).total_quantity, 20);
  const d = await one(`select modification_ouverte_le, modifie_apres_acceptation_motif m from quotes where id=$1`, [A.quote]);
  assert.equal(d.modification_ouverte_le, null);
  assert.equal(d.m, "Le client passe à 15 pièces et ajoute un modèle noir");
  assert.equal((await one(`select count(*)::int n from audit_log where entity_id=$1 and action='modifier_devis_accepte'`, [A.quote])).n, 1);
});

await test("appliquer : refusé si la configuration est incomplète, la modification reste ouverte", async () => {
  await comme(admin, `select ouvrir_modification_devis($1,'Correction des tailles')`, [A.quote]);
  await comme(admin, `select set_quote_line_sizes($1,$2)`, [nouvelle, { [M]: 3 }]);
  await expectFail(() => comme(admin, `select appliquer_modification_devis($1)`, [A.quote]), /totalise 3 pièces pour 5/);
  assert.equal((await one(`select modification_ouverte_le is not null o from quotes where id=$1`, [A.quote])).o, true);
});

await test("retirer une ligne : l'article d'ODF né de cette ligne disparaît aussi", async () => {
  await comme(admin, `select retirer_ligne_devis_modifie($1)`, [nouvelle]);
  assert.equal((await one(`select count(*)::int n from quote_lines where id=$1`, [nouvelle])).n, 0);
  assert.equal((await one(`select count(*)::int n from production_order_lines where production_order_id=$1`, [A.po])).n, 1);
  await comme(admin, `select appliquer_modification_devis($1)`, [A.quote]);
  assert.equal((await one(`select total_quantity from production_orders where id=$1`, [A.po])).total_quantity, 15);
});

await test("ODF sorti du brouillon : la proforma ne se modifie plus", async () => {
  const B = await devisAccepte("DEV-MOD-B");
  await as(null);
  await q(`update production_orders set status='en_attente_validation' where id=$1`, [B.po]);
  await expectFail(() => comme(admin, `select ouvrir_modification_devis($1,'trop tard')`, [B.quote]), /n'est plus en brouillon/);
});

await test("hors modification : les verrous « devis envoyé » restent en place", async () => {
  await expectFail(() => comme(admin, `select set_quote_line_sizes($1,$2)`, [A.line, { [M]: 15 }]), /ne se modifie plus/);
});

console.log("Modification d'une proforma acceptée : tous les tests passent");
