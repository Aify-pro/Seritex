// Suivi client (migration 0132) : ce qu'un compte CLIENT voit des commandes et des livraisons —
// seulement les vues client_* (état simplifié, sans donnée interne), plus aucune lecture directe des tables.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();
const commercial = await mkUser("commercial");
const livreur = await mkUser("livreur");
const livreurAutre = await mkUser("livreur");

const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const B = (await one(`insert into companies(name) values ('Société B') returning id`)).id;
const clientA = await mkUser("client", { company_id: A });
const clientB = await mkUser("client", { company_id: B });
const orphelin = crypto.randomUUID();
await q(`insert into auth.users(id,email) values ($1,'orphelin@t.ci')`, [orphelin]);
await q(`select create_site_account($1,'orphelin@t.ci','Orphelin Test','0700000000',null)`, [orphelin]);

const odf = async (ref, company, statut, extra = "") =>
  (await one(`insert into production_orders(reference, company_id, total_quantity, status ${extra ? ", " + extra.split("=")[0] : ""}) values ($1,$2,50,$3 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [ref, company, statut])).id;
const oA = await odf("ODF-A-PROD", A, "en_production");
const oRefus = await odf("ODF-A-REFUS", A, "refuse", "refus_motif='MOTIF INTERNE'");
const oBrouillon = await odf("ODF-A-BROUILLON", A, "brouillon");
const oFin = await odf("ODF-A-FIN", A, "terminee");
const oB = await odf("ODF-B-PROD", B, "en_production");
const oStock = (await one(`insert into production_orders(reference, company_id, total_quantity, status) values ('ODF-STOCK', null, 10, 'en_production') returning id`)).id;

const pm = (await one(`insert into product_models(name, nature) values ('Tee X','pf') returning id`)).id;
const pol = (await one(`insert into production_order_lines(production_order_id, product_model_id, description, quantity) values ($1,$2,'T-shirt Tee X noir',50) returning id`, [oA, pm])).id;
const sect = (await one(`select id from sections where name='Coupe'`)).id;
await q(`insert into work_orders(reference, production_order_id, production_order_line_id, section_id, quantity_planned, quantity_done) values ('OT-1',$1,$3,$2,50,10)`, [oA, sect, pol]);

const exp = async (company, odfId, statut, extra = {}) =>
  (await one(
    `insert into shipments(company_id, production_order_id, statut, notes, cout_estime, cout_reel, carrier_ref, livreur_id, mode, lieu_libelle, reference)
     values ($1,$2,$3,'NOTE INTERNE',1000,2000,'TR-1',$4,'livraison','Entrepôt Yopougon',$5) returning id`,
    [company, odfId, statut, extra.livreur ?? null, extra.reference ?? null]
  )).id;
const sCompta = await exp(A, oA, "validee_compta", { reference: "BL-2026-0001" });
const sEnRoute = await exp(A, oA, "en_route", { reference: "BL-2026-0002", livreur });
const sEchec = await exp(A, oA, "echec", { reference: "BL-2026-0003" });
const sAnnulee = await exp(A, oA, "annulee", { reference: "BL-2026-0004" });
const sB = await exp(B, oB, "planifiee", { reference: "BL-2026-0005" });

// Ligne d'expédition : un article, une taille.
const taille = (await one(`select cle from sizes order by display_order limit 1`)).cle;
await q(`insert into shipment_lines(shipment_id, production_order_line_id, taille, quantite) values ($1,$2,$3,20)`, [sEnRoute, pol, taille]);
await q(`insert into shipment_events(shipment_id, statut, latitude, longitude, commentaire) values ($1,'validee_compta',5.3,-4.0,'COMMENTAIRE INTERNE'), ($1,'planifiee',5.3,-4.0,null), ($1,'en_route',5.31,-4.01,null)`, [sEnRoute]);
await q(`insert into shipment_documents(shipment_id, type, path, latitude, longitude) values ($1,'photo','p/x.jpg',5.3,-4.0)`, [sEnRoute]);

async function comme(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const col = (rows, k) => rows.map((r) => r[k]).sort();

await test("commandes : un client voit les ODF de sa société avec un état simplifié, jamais le statut interne", async () => {
  const r = await comme(clientA, `select reference, etat from client_commandes order by reference`);
  assert.deepEqual(r.map((x) => [x.reference, x.etat]), [
    ["ODF-A-BROUILLON", "en_preparation"], ["ODF-A-FIN", "terminee"], ["ODF-A-PROD", "en_fabrication"], ["ODF-A-REFUS", "en_preparation"],
  ]);
  assert.deepEqual(col(await comme(clientB, `select reference from client_commandes`), "reference"), ["ODF-B-PROD"]);
});

await test("commandes : section en cours reprise, aucune colonne interne exposée", async () => {
  const r = (await comme(clientA, `select * from client_commandes where reference='ODF-A-PROD'`))[0];
  assert.equal(r.section_en_cours, "Coupe");
  for (const interdit of ["status", "refus_motif", "cloture_note", "bilan_cloture", "created_by", "comptabilite_validee_le"]) assert.ok(!(interdit in r), interdit);
});

await test("commandes : un ODF de stock (sans client) et un compte non rattaché ne voient rien", async () => {
  assert.ok(!col(await comme(clientA, `select reference from client_commandes`), "reference").includes("ODF-STOCK"));
  assert.equal((await comme(orphelin, `select count(*)::int n from client_commandes`))[0].n, 0);
});

await test("livraisons : état simplifié (étape comptable cachée, échec = à replanifier), annulée invisible", async () => {
  const r = await comme(clientA, `select reference, etat from client_livraisons order by reference`);
  assert.deepEqual(r.map((x) => [x.reference, x.etat]), [
    ["BL-2026-0001", "en_preparation"], ["BL-2026-0002", "en_route"], ["BL-2026-0003", "a_replanifier"],
  ]);
  assert.deepEqual(col(await comme(clientB, `select reference from client_livraisons`), "reference"), ["BL-2026-0005"]);
});

await test("livraisons : aucun coût, note, livreur ni GPS dans les vues", async () => {
  const l = (await comme(clientA, `select * from client_livraisons limit 1`))[0];
  for (const interdit of ["notes", "cout_estime", "cout_reel", "carrier_ref", "livreur_id", "statut", "reglement_montant", "lieu_latitude", "motif_echec"]) assert.ok(!(interdit in l), interdit);
  const e = (await comme(clientA, `select * from client_livraison_suivi limit 1`))[0];
  for (const interdit of ["latitude", "longitude", "commentaire", "auteur", "source", "statut"]) assert.ok(!(interdit in e), interdit);
});

await test("livraisons : quantité, lignes par article et taille, historique sans l'étape comptable", async () => {
  const l = (await comme(clientA, `select quantite from client_livraisons where reference='BL-2026-0002'`))[0];
  assert.equal(l.quantite, 20);
  const lignes = await comme(clientA, `select designation, quantite from client_livraison_lignes where shipment_id=$1`, [sEnRoute]);
  assert.deepEqual(lignes.map((x) => [x.designation, x.quantite]), [["T-shirt Tee X noir", 20]]);
  assert.deepEqual((await comme(clientA, `select etat from client_livraison_suivi where shipment_id=$1 order by occurred_at, etat`, [sEnRoute])).map((x) => x.etat).sort(), ["en_preparation", "en_route", "planifiee"]);
  assert.equal((await comme(clientB, `select count(*)::int n from client_livraison_lignes where shipment_id=$1`, [sEnRoute]))[0].n, 0, "lignes d'une autre société");
  assert.equal((await comme(orphelin, `select count(*)::int n from client_livraisons`))[0].n, 0);
});

await test("PLUS DE LECTURE DIRECTE : un client ne lit aucune ligne des tables internes", async () => {
  for (const uid of [clientA, orphelin]) {
    for (const t of ["production_orders", "shipments", "shipment_lines", "shipment_packages", "shipment_events", "shipment_documents"]) {
      assert.equal((await comme(uid, `select count(*)::int n from ${t}`))[0].n, 0, t);
    }
  }
});

await test("le personnel garde ses droits : commercial (ODF), livreur affecté (sa livraison seulement)", async () => {
  assert.ok((await comme(commercial, `select count(*)::int n from production_orders`))[0].n >= 5);
  assert.deepEqual(col(await comme(livreur, `select reference from shipments`), "reference"), ["BL-2026-0002"]);
  assert.equal((await comme(livreur, `select count(*)::int n from shipment_events`))[0].n, 3);
  assert.equal((await comme(livreurAutre, `select count(*)::int n from shipments`))[0].n, 0);
});

console.log("OK");
process.exit(0);
