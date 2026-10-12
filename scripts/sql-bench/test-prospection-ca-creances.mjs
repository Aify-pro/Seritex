// Scénarios SQL (migration 0123) : CA et créances Sage par client, indicateurs du planning.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|permission denied/i.test(e.message)) return { ok: false, rows: [] };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}

const u = {};
for (const k of ["administrateur", "direction", "commercial", "infographiste"]) u[k] = await mkUser(k);

const an = Number((await one(`select extract(year from (now() at time zone 'Africa/Abidjan'))::int n`)).n);

// Fiches Sage : créées par la synchronisation seule (déclencheur 0059), mis de côté ici.
await db.exec("set session_replication_role = replica");
const orange = await one(`insert into companies(name, sage_code, origin) values ('ORANGE CI', 'ORA001', 'sage') returning id`);
const nestle = await one(`insert into companies(name, sage_code, origin) values ('NESTLE CI', 'NES000', 'sage') returning id`);
await one(`insert into companies(name) values ('Prospect sans Sage') returning id`);
await db.exec("set session_replication_role = origin");

// Écritures du job NAS (service_role : hors RLS, ici en superutilisateur).
await q(
  `insert into sage_client_ca(client_sage_code, annee, ca_ht, ca_ttc, nb_factures, derniere_facture) values
   ('ORA001', $1, 100, 118, 3, make_date($1, 3, 2)),
   ('ORA001', $1 - 1, 50, 59, 1, make_date($1 - 1, 11, 20)),
   ('ORA001', $1 - 2, 999, 999, 9, make_date($1 - 2, 1, 5)),
   ('NES000', $1 - 1, 200, 236, 4, make_date($1 - 1, 6, 1))`,
  [an]
);
await q(`insert into sage_client_creances(client_sage_code, montant_ttc, nb_factures, plus_ancienne) values ('ORA001', 2714000, 2, '2026-05-04')`);
await q(
  `insert into sage_quotes_view(sage_piece, doc_date, client_sage_code, total_ht, total_ttc) values
   ('DV1', '2026-09-01', 'ORA001', 100, 118), ('DV2', '2026-09-20', 'ORA001', 200, 236)`
);

await test("indicateurs : CA de l'année et de la précédente, devis en cours cumulés, créance, dernière facture", async () => {
  const r = (await run(u.direction, `select * from prospection_indicateurs_clients where company_id = $1`, [orange.id])).rows[0];
  assert.equal(Number(r.ca_annee_ttc), 118);
  assert.equal(Number(r.ca_annee_precedente_ttc), 59);
  assert.equal(Number(r.devis_en_cours_ttc), 354);
  assert.equal(r.nb_devis_en_cours, 2);
  assert.equal(r.dernier_devis.toISOString().slice(0, 10), "2026-09-20");
  assert.equal(Number(r.creance_ttc), 2714000);
  assert.equal(r.derniere_facture.getFullYear(), an);
});

await test("indicateurs : client sans données = zéros ; les prospects hors Sage n'apparaissent pas", async () => {
  const rows = (await run(u.direction, `select * from prospection_indicateurs_clients`)).rows;
  assert.equal(rows.length, 2);
  const n = rows.find((x) => x.company_id === nestle.id);
  assert.equal(Number(n.ca_annee_ttc), 0);
  assert.equal(Number(n.ca_annee_precedente_ttc), 236);
  assert.equal(Number(n.creance_ttc), 0);
  assert.equal(n.dernier_devis, null);
});

await test("droits : module Prospection requis pour lire CA et créances ; aucune écriture applicative", async () => {
  assert.equal((await run(u.commercial, `select * from sage_client_ca`)).rows.length, 4);
  assert.equal((await run(u.infographiste, `select * from sage_client_ca`)).rows.length, 0);
  assert.equal((await run(u.infographiste, `select * from sage_client_creances`)).rows.length, 0);
  assert.equal((await run(u.administrateur, `insert into sage_client_creances(client_sage_code, montant_ttc) values ('X', 1)`)).ok, false);
  assert.equal((await run(u.administrateur, `update sage_client_ca set ca_ttc = 0 returning annee`)).rows.length, 0);
});

await test("contraintes : une ligne par client et par année", async () => {
  await assert.rejects(q(`insert into sage_client_ca(client_sage_code, annee) values ('ORA001', $1)`, [an]), /unique|duplicate/);
  await assert.rejects(q(`insert into sage_client_ca(client_sage_code, annee) values ('ORA001', 1999)`), /check/);
});
