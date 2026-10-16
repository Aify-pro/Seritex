// Migration 0136 : les fichiers envoyés par le site (logos, maquette PDF, image de la maquette) se préparent
// pour la médiathèque du client dès que la demande a une société ; le fichier du bucket reste la source.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

async function asRole(role, sql, params) {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const service = (sql, params) => asRole("service_role", sql, params);
const demande = async (p) => (await service(`select create_site_demande($1::jsonb) r`, [JSON.stringify(p)]))[0].r;
const prepare = async (id) => (await service(`select prepare_site_file_import($1) r`, [id]))[0].r;

const tissu = await one(`insert into textiles(nom, grammage) values ('Jersey S 150',150) returning id`);
const noir = await one(`insert into colors(name, code, hex) values ('Noir S','NS','#000000') returning id`);
const tee = await one(`insert into product_models(name, nature, publiable_eshop) values ('Tee S','pf',true) returning id`);
await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [tee.id, tissu.id]);
await q(`insert into product_model_colors values ($1,$2)`, [tee.id, noir.id]);
const poitrine = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'poitrine','Poitrine',1) returning id`, [tee.id]);
await q(`update site_settings set eshop_actif = true, personnaliser_actif = true`);

const deposer = (path, mime) => q(`insert into storage.objects(bucket_id, name, metadata) values ('site-personnalisation',$1,$2)`, [path, { mimetype: mime, size: 2048 }]);
const article = { modele_id: tee.id, couleur_id: noir.id, textile_id: tissu.id, quantite: "30", marquages: [{ emplacement_id: poitrine.id, largeur_cm: 9, technique_libelle: "Sérigraphie", nb_couleurs: 2 }] };
async function envoi(email) {
  const id = crypto.randomUUID();
  await deposer(`envois/${id}/1-logo.png`, "image/png");
  await deposer(`envois/${id}/2-maquette.pdf`, "application/pdf");
  await deposer(`envois/${id}/3-maquette.png`, "image/png");
  const r = await demande({
    envoi_id: id, nom: "Awa Import", entreprise: "Awa SARL", email, telephone: "0700000009", articles: [article],
    fichiers: [
      { path: `envois/${id}/1-logo.png`, nom: "logo.png", role: "logo", marquage: 1, article: 1 },
      { path: `envois/${id}/2-maquette.pdf`, nom: "maquette.pdf", role: "maquette", article: 1 },
      { path: `envois/${id}/3-maquette.png`, nom: "maquette.png", role: "apercu", article: 1 },
    ],
  });
  const fichiers = await q(`select id, role from request_site_files where request_id=$1`, [r.id]);
  return { r, fichiers: Object.fromEntries(fichiers.map((f) => [f.role, f.id])) };
}

// Client connu : un contact de la société porte cet e-mail → la demande est reconnue.
const societe = (await one(`insert into companies(name, email) values ('Awa SARL', 'contact@awa.ci') returning id`)).id;
await q(`insert into contacts(company_id, first_name, last_name, email, is_primary_contact) values ($1,'Awa','Import','awa.connue@exemple.ci',true)`, [societe]);

await test("create_site_demande accepte le rôle « apercu » (image de la maquette)", async () => {
  const { fichiers } = await envoi("prospect@exemple.ci");
  assert.deepEqual(Object.keys(fichiers).sort(), ["apercu", "logo", "maquette"]);
});

await test("demande de prospect (sans société) : rien n'est importé tant qu'elle n'a pas de client", async () => {
  const p = await one(`select id from requests where source='site' and company_id is null order by created_at limit 1`);
  const f = await q(`select id from request_site_files where request_id=$1`, [p.id]);
  for (const x of f) assert.equal((await prepare(x.id)).statut, "sans_client");
  assert.equal((await one(`select count(*)::int n from media_files`)).n, 0);
});

const connu = await envoi("awa.connue@exemple.ci");
await test("client reconnu : logo → visuel, maquette PDF et image → maquette, rattachés à la demande", async () => {
  assert.equal((await one(`select company_id from requests where id=$1`, [connu.r.id])).company_id, societe);
  const l = await prepare(connu.fichiers.logo);
  const m = await prepare(connu.fichiers.maquette);
  const a = await prepare(connu.fichiers.apercu);
  for (const x of [l, m, a]) assert.equal(x.statut, "a_envoyer");
  const cat = async (r) => (await one(`select category, company_id, file_name, current_version_id from media_files where id=$1`, [r.media_file_id]));
  assert.equal((await cat(l)).category, "visuel");
  assert.equal((await cat(m)).category, "maquette");
  assert.equal((await cat(a)).category, "maquette");
  assert.equal((await cat(l)).company_id, societe);
  assert.match((await cat(l)).file_name, /^WEB.* · article 1 · logo\.png$/);
  assert.match((await cat(m)).file_name, /maquette \(PDF\)\.pdf$/);
  assert.match((await cat(a)).file_name, /maquette \(image\)\.png$/);
  assert.equal((await q(`select 1 from request_media_files where request_id=$1`, [connu.r.id])).length, 3);
  assert.equal((await q(`select 1 from media_file_events where reason like 'Import automatique%'`)).length, 3);
  assert.equal(l.version_id, (await cat(l)).current_version_id);
  assert.match(l.path, /^envois\/.+\/1-logo\.png$/);
});

await test("idempotent : relancer ne crée aucun doublon ; une fois importé, plus rien à envoyer", async () => {
  const avant = (await one(`select count(*)::int n from media_files`)).n;
  const again = await prepare(connu.fichiers.logo);
  assert.equal(again.statut, "a_envoyer");
  assert.equal((await one(`select count(*)::int n from media_files`)).n, avant);
  await q(`update request_site_files set imported_at = now() where id=$1`, [connu.fichiers.logo]);
  assert.equal((await prepare(connu.fichiers.logo)).statut, "deja_importe");
});

await test("rattachement tardif : le prospect devient client → ses fichiers deviennent importables", async () => {
  const p = await one(`select id from requests where source='site' and company_id is null order by created_at limit 1`);
  await q(`update requests set company_id=$2 where id=$1`, [p.id, societe]);
  const f = await q(`select id from request_site_files where request_id=$1`, [p.id]);
  for (const x of f) assert.equal((await prepare(x.id)).statut, "a_envoyer");
});

await test("seul le service_role peut préparer un import (l'API publique est refusée)", async () => {
  await db.exec("set role authenticated");
  try {
    await expectFail(() => q(`select prepare_site_file_import($1)`, [connu.fichiers.maquette]), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

console.log("OK");
process.exit(0);
