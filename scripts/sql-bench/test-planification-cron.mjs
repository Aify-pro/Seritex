// Scénarios SQL (migration 0137) : planification des tâches automatiques pg_cron / pg_net.
// PGlite n'a ni pg_cron ni pg_net : on en simule les fonctions pour vérifier ce qui serait planifié.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setup, test } from "./fixture.mjs";

const { db, q, one } = await setup();
const migration = readFileSync(new URL("../../supabase/migrations/0137_planification_taches_cron.sql", import.meta.url), "utf8");

await test("sans pg_cron / pg_net / Vault : la migration ne fait rien et ne casse pas", async () => {
  await db.exec(migration);
  assert.equal((await one(`select to_regclass('cron.job') is null as absent`)).absent, true);
});

// Faux pg_cron, pg_net et Vault.
await db.exec(`
  create schema cron;
  create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_nom text, p_horaire text, p_commande text) returns bigint language sql as $$
    insert into cron.job(jobname, schedule, command) values (p_nom, p_horaire, p_commande) returning jobid::bigint $$;
  create schema net;
  create table net.appels (url text, entetes jsonb, delai int);
  create function net.http_get(url text, headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$
    insert into net.appels values (url, headers, timeout_milliseconds) returning 1::bigint $$;
  create schema vault;
  create view vault.decrypted_secrets as select 'notifications_secret'::text as name, 'secret-de-test'::text as decrypted_secret;
`);

await test("avec les extensions : les trois tâches sont planifiées, aux bons horaires", async () => {
  await db.exec(migration);
  const j = await q(`select jobname, schedule from cron.job order by jobname`);
  assert.deepEqual(j, [
    { jobname: "mediatheque-importer-fichiers-site", schedule: "* * * * *" },
    { jobname: "mediatheque-vider-tampon", schedule: "*/5 * * * *" },
    { jobname: "notifications-traiter", schedule: "* * * * *" },
  ]);
});

await test("rejouée : aucun doublon, aucune tâche remplacée", async () => {
  await q(`update cron.job set schedule = '*/10 * * * *' where jobname = 'notifications-traiter'`);
  await db.exec(migration);
  assert.equal((await one(`select count(*)::int n from cron.job`)).n, 3);
  assert.equal((await one(`select schedule from cron.job where jobname = 'notifications-traiter'`)).schedule, "*/10 * * * *");
});

await test("les commandes sont du SQL valide : sans travail en attente aucun appel, avec travail un appel au bon chemin et au bon secret", async () => {
  const commande = async (nom) => (await one(`select command from cron.job where jobname = $1`, [nom])).command;
  // Rien en attente : aucun appel.
  await db.exec(await commande("mediatheque-importer-fichiers-site"));
  await db.exec(await commande("mediatheque-vider-tampon"));
  assert.equal((await one(`select count(*)::int n from net.appels`)).n, 0);
  // Fichier du site à copier, demande avec société : un appel.
  const societe = (await one(`insert into companies(name) values ('Société T') returning id`)).id;
  const dem = (await one(`insert into requests(reference, company_id, status) values ('DEM-T', $1, 'nouvelle') returning id`, [societe])).id;
  await q(`insert into request_site_files(request_id, path, file_name, role) values ($1,'envois/x/a.pdf','a.pdf','maquette')`, [dem]);
  await db.exec(await commande("mediatheque-importer-fichiers-site"));
  const appel = await one(`select url, entetes, delai from net.appels`);
  assert.equal(appel.url, "https://app.seritex.ci/api/media/importer-site");
  assert.equal(appel.entetes.Authorization, "Bearer secret-de-test");
  assert.equal(appel.delai, 300000);
  // La file des notifications : on vérifie seulement que la commande est exécutable.
  await db.exec(await commande("notifications-traiter"));
});

console.log("OK");
process.exit(0);
