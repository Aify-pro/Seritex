// Ce que la base laisse voir à un compte CLIENT — garanties dont dépend l'espace client du site
// (www.seritex.ci/espace-client), qui lit avec la session du client et jamais avec la clé de service.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();
const commercial = await mkUser("commercial");

const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const B = (await one(`insert into companies(name) values ('Société B') returning id`)).id;
const clientA = await mkUser("client", { company_id: A });
const clientB = await mkUser("client", { company_id: B });

// Compte du site pas encore rattaché (0125) : client sans société.
const orphelin = crypto.randomUUID();
await q(`insert into auth.users(id,email) values ($1,'orphelin@t.ci')`, [orphelin]);
await q(`select create_site_account($1,'orphelin@t.ci','Orphelin Test','0700000000',null)`, [orphelin]);

const req = async (ref, company, statut) =>
  (await one(`insert into requests(reference, company_id, status, description) values ($1,$2,$3,'desc ' || $1) returning id`, [ref, company, statut])).id;
const rA1 = await req("DEM-A1", A, "devis_envoye");
const rA2 = await req("DEM-A2", A, "nouvelle");
const rB1 = await req("DEM-B1", B, "devis_envoye");

const devis = async (ref, request, company, statut) => {
  const id = (await one(`insert into quotes(reference, request_id, company_id, status, total_amount) values ($1,$2,$3,$4,1000) returning id`, [ref, request, company, statut])).id;
  await q(`insert into quote_lines(quote_id, description, quantity, unit_price) values ($1,'Ligne ' || $2, 10, 100)`, [id, ref]);
  return id;
};
await devis("DEV-A-BROUILLON", rA1, A, "brouillon");
await devis("DEV-A-VALIDATION", rA1, A, "en_validation_interne");
await devis("DEV-A-ENVOYE", rA1, A, "envoye");
await devis("DEV-B-ENVOYE", rB1, B, "envoye");

await q(`insert into messages(request_id, sender_id, body) values ($1,$2,'Bonjour, votre devis est prêt')`, [rA1, commercial]);
await q(`insert into messages(request_id, sender_id, body) values ($1,$2,'Message pour B')`, [rB1, commercial]);
await q(`insert into request_site_files(request_id, path, file_name, role) values ($1,'envois/x/a.pdf','a.pdf','maquette'), ($2,'envois/x/b.pdf','b.pdf','maquette')`, [rA1, rB1]);

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

await test("un client ne voit que les demandes de sa société", async () => {
  assert.deepEqual(col(await comme(clientA, `select reference from requests`), "reference"), ["DEM-A1", "DEM-A2"]);
  assert.deepEqual(col(await comme(clientB, `select reference from requests`), "reference"), ["DEM-B1"]);
});

await test("un client ne voit ni les devis en brouillon ni ceux en validation interne", async () => {
  assert.deepEqual(col(await comme(clientA, `select reference from quotes`), "reference"), ["DEV-A-ENVOYE"]);
  assert.deepEqual(col(await comme(clientB, `select reference from quotes`), "reference"), ["DEV-B-ENVOYE"]);
});

await test("les lignes de devis suivent la même règle (pas de ligne d'un devis non envoyé)", async () => {
  assert.deepEqual(col(await comme(clientA, `select description from quote_lines`), "description"), ["Ligne DEV-A-ENVOYE"]);
});

await test("les échanges et les fichiers de la demande restent à la société", async () => {
  assert.deepEqual(col(await comme(clientA, `select body from messages`), "body"), ["Bonjour, votre devis est prêt"]);
  assert.deepEqual(col(await comme(clientA, `select file_name from request_site_files`), "file_name"), ["a.pdf"]);
  assert.deepEqual(col(await comme(clientB, `select file_name from request_site_files`), "file_name"), ["b.pdf"]);
});

await test("un compte du site non rattaché ne voit RIEN", async () => {
  for (const t of ["requests", "quotes", "quote_lines", "messages", "request_site_files", "companies", "contacts"]) {
    assert.equal((await comme(orphelin, `select count(*)::int n from ${t}`))[0].n, 0, t);
  }
});

await test("un client ne lit pas la fiche d'une autre société ni les comptes du personnel", async () => {
  assert.deepEqual(col(await comme(clientA, `select name from companies`), "name"), ["Société A"]);
  const staff = await comme(clientA, `select id from app_users where id = $1`, [commercial]);
  assert.equal(staff.length, 0, "les comptes du personnel ne sont pas lisibles par un client");
});

await test("un compte client ne lit pas les prix mémorisés par client, ni les demandes de prospects du site", async () => {
  await q(`insert into requests(reference, company_id, status, prospect, source) values ('DEM-PROSPECT', null, 'nouvelle', '{"nom":"Prospect Secret","email":"p@x.ci"}'::jsonb, 'site')`);
  for (const uid of [clientA, orphelin]) {
    const refs = col(await comme(uid, `select reference from requests`), "reference");
    assert.ok(!refs.includes("DEM-PROSPECT"), "prospect visible");
  }
  assert.equal((await comme(clientA, `select count(*)::int n from client_model_prices`))[0].n, 0);
  assert.equal((await comme(orphelin, `select count(*)::int n from client_model_prices`))[0].n, 0);
});

await test("un client ne peut créer une demande ou un échantillon qu'au nom de SA société", async () => {
  const rB2 = await req("DEM-B2", B, "nouvelle");
  const echec = async (sql, params) => {
    try { await comme(clientA, sql, params); } catch (e) { return e.message; }
    return null;
  };
  assert.match((await echec(`insert into requests(reference, company_id, status) values ('X-B', $1, 'nouvelle')`, [B])) ?? "", /row-level security/);
  assert.equal(await echec(`insert into requests(reference, company_id, status) values ('X-A', $1, 'nouvelle')`, [A]), null, "sa propre société reste permise");
  assert.match((await echec(`insert into sample_requests(reference, company_id, request_id, need_description) values ('S-B', $1, $2, 'x')`, [B, rB2])) ?? "", /row-level security/);
});

await test("le personnel garde ses droits : le commercial voit toujours les demandes et les devis de toutes les sociétés", async () => {
  assert.ok((await comme(commercial, `select count(*)::int n from requests`))[0].n >= 3);
  assert.equal((await comme(commercial, `select count(*)::int n from quotes`))[0].n, 4);
});

console.log("OK");
process.exit(0);
