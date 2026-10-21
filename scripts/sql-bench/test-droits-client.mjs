// Droits de l'espace client (migration 0140) : par société, avec restriction possible par compte.
// Tout est permis par défaut ; un droit retiré l'est pour l'API (RLS, vues, fonctions), pas seulement à l'écran.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
const livreur = await mkUser("livreur");

const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const B = (await one(`insert into companies(name) values ('Société B') returning id`)).id;
const clientA1 = await mkUser("client", { company_id: A });
const clientA2 = await mkUser("client", { company_id: A });
const clientB = await mkUser("client", { company_id: B });

// --- Données ----------------------------------------------------------------
const req = async (ref, company) => (await one(`insert into requests(reference, company_id, status, description) values ($1,$2,'devis_envoye','d') returning id`, [ref, company])).id;
const rA = await req("DEM-A", A);
const rB = await req("DEM-B", B);
const devis = async (ref, request, company) => {
  const id = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ($1,$2,$3,'envoye',1000) returning id`, [ref, request, company])).id;
  await q(`insert into quote_lines(quote_id, description, quantity, unit_price) values ($1,'Ligne ' || $2,10,100)`, [id, ref]);
  return id;
};
const qA = await devis("DEV-A", rA, A);
const qA2 = await devis("DEV-A2", rA, A);
const qB = await devis("DEV-B", rB, B);

const oA = (await one(`insert into production_orders(reference, company_id, total_quantity, status) values ('ODF-A', $1, 50, 'en_production') returning id`, [A])).id;
const oB = (await one(`insert into production_orders(reference, company_id, total_quantity, status) values ('ODF-B', $1, 50, 'en_production') returning id`, [B])).id;
const pm = (await one(`insert into product_models(name, nature) values ('Tee X','pf') returning id`)).id;
const pol = (await one(`insert into production_order_lines(production_order_id, product_model_id, description, quantity) values ($1,$2,'T-shirt',50) returning id`, [oA, pm])).id;
const taille = (await one(`select cle from sizes order by display_order limit 1`)).cle;
const exp = async (company, odf, ref) =>
  (await one(`insert into shipments(company_id, production_order_id, statut, mode, reference) values ($1,$2,'planifiee','livraison',$3) returning id`, [company, odf, ref])).id;
const sA = await exp(A, oA, "BL-A");
const sB = await exp(B, oB, "BL-B");
await q(`insert into shipment_lines(shipment_id, production_order_line_id, taille, quantite) values ($1,$2,$3,20)`, [sA, pol, taille]);
await q(`insert into shipment_events(shipment_id, statut) values ($1,'planifiee')`, [sA]);

await q(`insert into media_files(company_id, file_name, category) values ($1,'logo-a.png','visuel'), ($2,'logo-b.png','visuel')`, [A, B]);
// Échantillons sur des demandes sans devis (sinon la base exige une ligne d'article).
const rEchA = (await one(`insert into requests(reference, company_id, status, description) values ('DEM-ECH-A',$1,'nouvelle','d') returning id`, [A])).id;
const rEchB = (await one(`insert into requests(reference, company_id, status, description) values ('DEM-ECH-B',$1,'nouvelle','d') returning id`, [B])).id;
await q(`insert into sample_requests(reference, company_id, request_id, need_description) values ('ECH-A',$1,$2,'x'), ('ECH-B',$3,$4,'x')`, [A, rEchA, B, rEchB]);

// --- Outils -----------------------------------------------------------------
async function comme(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const n = async (uid, sql, params) => (await comme(uid, `select count(*)::int n from (${sql}) t`, params))[0].n;
const regler = async (droit, autorise, { company = A, user = null } = {}) => {
  await as(admin);
  await q(`select definir_droit_client($1,$2,$3,$4)`, [company, droit, autorise, user]);
};

const DROITS = ["devis_voir", "devis_accepter", "commandes_voir", "livraisons_voir", "mediatheque_voir", "demandes_creer", "echantillons_voir"];
const lectures = {
  devis_voir: `select id from quotes`,
  commandes_voir: `select id from client_commandes`,
  livraisons_voir: `select id from client_livraisons`,
  mediatheque_voir: `select id from media_files`,
  echantillons_voir: `select id from sample_requests`,
};

// --- Tests ------------------------------------------------------------------
await test("par défaut tout est permis : aucun comportement ne change pour les comptes existants", async () => {
  for (const [droit, sql] of Object.entries(lectures)) assert.equal(await n(clientA1, sql), droit === "devis_voir" ? 2 : 1, droit);
  assert.equal(await n(clientA1, `select id from quote_lines`), 2);
  assert.equal(await n(clientA1, `select id from client_livraison_lignes`), 1);
  assert.equal(await n(clientA1, `select id from client_livraison_suivi`), 1);
  const eff = await comme(clientA1, `select droit, autorise from client_droits_effectifs() order by droit`);
  assert.deepEqual(eff.map((r) => r.droit), [...DROITS].sort());
  assert.ok(eff.every((r) => r.autorise));
});

await test("retrait pour la SOCIÉTÉ : tous ses comptes perdent la lecture, l'autre société et le personnel non", async () => {
  await regler("devis_voir", false);
  for (const uid of [clientA1, clientA2]) {
    assert.equal(await n(uid, `select id from quotes`), 0);
    assert.equal(await n(uid, `select id from quote_lines`), 0, "lignes du devis");
  }
  assert.equal(await n(clientB, `select id from quotes`), 1);
  assert.equal((await q(`select count(*)::int n from quotes`))[0].n, 3, "le personnel voit tout");
  assert.equal(await n(clientA1, `select id from requests`), 2, "les demandes restent visibles");
  await regler("devis_voir", true);
  assert.equal(await n(clientA1, `select id from quotes`), 2);
});

await test("retrait pour UN COMPTE : seul ce compte est restreint", async () => {
  await regler("commandes_voir", false, { user: clientA1 });
  assert.equal(await n(clientA1, `select id from client_commandes`), 0);
  assert.equal(await n(clientA2, `select id from client_commandes`), 1);
  assert.equal(await n(clientA1, `select id from client_livraisons`), 1, "les autres droits du compte restent");
  const eff = await comme(clientA1, `select autorise from client_droits_effectifs() where droit='commandes_voir'`);
  assert.equal(eff[0].autorise, false);
  await regler("commandes_voir", true, { user: clientA1 });
  assert.equal(await n(clientA1, `select id from client_commandes`), 1);
});

await test("un compte n'a jamais PLUS que sa société : « hériter » ne rend pas un droit retiré à la société", async () => {
  await regler("livraisons_voir", false);
  await regler("livraisons_voir", true, { user: clientA1 });
  assert.equal(await n(clientA1, `select id from client_livraisons`), 0);
  for (const v of ["client_livraison_lignes", "client_livraison_suivi"]) assert.equal(await n(clientA1, `select id from ${v}`), 0, v);
  assert.equal(await n(clientB, `select id from client_livraisons`), 1);
  await regler("livraisons_voir", true);
  assert.equal(await n(clientA1, `select id from client_livraisons`), 1);
});

await test("accepter un devis : droit distinct de le voir, contrôlé dans la fonction", async () => {
  await regler("devis_accepter", false);
  assert.equal(await n(clientA1, `select id from quotes`), 2, "il voit toujours ses devis");
  await expectFail(() => comme(clientA1, `select accept_quote($1)`, [qA]), /accès refusé/);
  assert.equal((await one(`select status::text s from quotes where id=$1`, [qA])).s, "envoye");
  await regler("devis_accepter", true);
  const po = (await comme(clientA1, `select accept_quote($1) as id`, [qA]))[0].id;
  assert.ok(po);
  assert.equal((await one(`select status::text s from quotes where id=$1`, [qA])).s, "accepte");
});

await test("médiathèque et échantillons : lecture fermée par le retrait", async () => {
  await regler("mediatheque_voir", false);
  await regler("echantillons_voir", false, { user: clientA2 });
  assert.equal(await n(clientA1, `select id from media_files`), 0);
  assert.equal(await n(clientA2, `select id from media_files`), 0);
  assert.equal(await n(clientB, `select id from media_files`), 1);
  assert.equal(await n(clientA1, `select id from sample_requests`), 1);
  assert.equal(await n(clientA2, `select id from sample_requests`), 0);
  await regler("mediatheque_voir", true);
  await regler("echantillons_voir", true, { user: clientA2 });
  assert.equal(await n(clientA1, `select id from media_files`), 1);
});

await test("créer une demande : droit contrôlé à l'écriture", async () => {
  await regler("demandes_creer", false);
  await expectFail(() => comme(clientA1, `insert into requests(reference, company_id, status) values ('X-A',$1,'nouvelle')`, [A]), /row-level security/);
  await comme(clientB, `insert into requests(reference, company_id, status) values ('X-B',$1,'nouvelle')`, [B]);
  await regler("demandes_creer", true);
  await comme(clientA1, `insert into requests(reference, company_id, status) values ('X-A2',$1,'nouvelle')`, [A]);
});

await test("réglage réservé au personnel autorisé, avec contrôles de cohérence", async () => {
  const appel = (uid, ...p) => comme(uid, `select definir_droit_client($1,$2,$3,$4)`, p);
  await expectFail(() => appel(clientA1, A, "devis_voir", true, null), /accès refusé/);
  await expectFail(() => appel(livreur, A, "devis_voir", false, null), /accès refusé/);
  await expectFail(() => appel(admin, A, "droit_inconnu", false, null), /droit inconnu/);
  await expectFail(() => appel(admin, A, "devis_voir", false, clientB), /pas un compte client de cette société/);
  await expectFail(() => appel(admin, A, "devis_voir", false, commercial), /pas un compte client de cette société/);
  await appel(admin, A, "devis_voir", false, null);
  await appel(admin, A, "devis_voir", false, null); // idempotent
  assert.equal((await one(`select count(*)::int n from client_droits_retires where company_id=$1 and droit='devis_voir'`, [A])).n, 1);
  await appel(admin, A, "devis_voir", true, null);
  assert.equal((await one(`select count(*)::int n from client_droits_retires`)).n, 0);
});

await test("les tables de retraits ne s'écrivent pas directement ; un client ne les lit pas ; le personnel autorisé les lit", async () => {
  await regler("devis_voir", false);
  await expectFail(() => comme(clientA1, `insert into client_droits_retires(company_id, droit) values ($1,'devis_voir')`, [A]), /row-level security/);
  await comme(clientA1, `delete from client_droits_retires`); // RLS : 0 ligne visible, donc rien supprimé
  assert.equal(await n(clientA1, `select id from client_droits_retires`), 0);
  assert.equal(await n(admin, `select id from client_droits_retires`), 1);
  await regler("devis_voir", true);
});

await test("client_droits_effectifs : vide pour le personnel", async () => {
  assert.equal((await comme(commercial, `select * from client_droits_effectifs()`)).length, 0);
});

console.log("OK");
process.exit(0);
