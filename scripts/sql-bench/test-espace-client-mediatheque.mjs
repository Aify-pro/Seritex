// Médiathèque vue du site (route /api/site/media/[id]) : ce que la base garantit à un compte CLIENT.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();
const A = (await one(`insert into companies(name) values ('Société A') returning id`)).id;
const B = (await one(`insert into companies(name) values ('Société B') returning id`)).id;
const clientA = await mkUser("client", { company_id: A });
const orphelin = crypto.randomUUID();
await q(`insert into auth.users(id,email) values ($1,'orphelin@t.ci')`, [orphelin]);
await q(`select create_site_account($1,'orphelin@t.ci','Orphelin Test','0700000000',null)`, [orphelin]);

const fichier = async (company, nom) => (await one(`insert into media_files(company_id, file_name, category) values ($1,$2,'visuel') returning id`, [company, nom])).id;
const fA = await fichier(A, "logo-a.png");
const fB = await fichier(B, "logo-b.png");
const cible = (await one(`select id from storage_targets limit 1`)).id;
const v = (await one(`insert into media_file_versions(media_file_id, version_number, file_name) values ($1,1,'logo-a.png') returning id`, [fA])).id;
await q(`insert into media_file_copies(media_file_version_id, storage_target_id, remote_path, sync_status) values ($1,$2,'mediatheque/a/logo-a.png','synchronise')`, [v, cible]);

async function comme(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

await test("un client lit sa propre ligne de profil (rôle) et voit les fichiers de SA société seulement", async () => {
  assert.equal((await comme(clientA, `select role::text r from app_users where id=$1`, [clientA]))[0].r, "client");
  assert.deepEqual((await comme(clientA, `select file_name from media_files`)).map((r) => r.file_name), ["logo-a.png"]);
  assert.equal((await comme(clientA, `select id from media_files where id=$1`, [fB])).length, 0, "fichier d'une autre société");
});

await test("un compte du site non rattaché ne voit aucun fichier", async () => {
  assert.equal((await comme(orphelin, `select count(*)::int n from media_files`))[0].n, 0);
});

await test("un client ne lit pas les cibles de stockage (identifiants du NAS) : la route lit le contenu côté serveur", async () => {
  assert.equal((await comme(clientA, `select count(*)::int n from storage_targets`))[0].n, 0);
});

console.log("OK");
process.exit(0);
