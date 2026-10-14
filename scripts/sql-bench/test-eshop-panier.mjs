// Scénarios SQL (migration 0126) : une demande du site à plusieurs articles (panier de l'e-shop).
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

async function asRole(role, uid, sql, params) {
  await as(uid);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const site = (sql, params) => asRole("service_role", null, sql, params);
const demande = async (p) => (await site(`select create_site_demande($1::jsonb) r`, [JSON.stringify(p)]))[0].r;

const tissu = await one(`insert into textiles(nom, grammage) values ('Jersey P 150',150) returning id`);
const blanc = await one(`insert into colors(name, code, hex) values ('Blanc P','BP','#FFFFFF') returning id`);
const noir = await one(`insert into colors(name, code, hex) values ('Noir P','NP','#000000') returning id`);
const tee = await one(`insert into product_models(name, nature, publiable_eshop) values ('Tee P','pf',true) returning id`);
const polo = await one(`insert into product_models(name, nature, publiable_eshop) values ('Polo P','pf',true) returning id`);
const cache = await one(`insert into product_models(name, nature, publiable_eshop) values ('Non publié','pf',false) returning id`);
for (const m of [tee, polo]) {
  await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [m.id, tissu.id]);
  for (const c of [blanc, noir]) await q(`insert into product_model_colors values ($1,$2)`, [m.id, c.id]);
}
const poitrineTee = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'poitrine','Poitrine',1) returning id`, [tee.id]);
const poitrinePolo = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'poitrine','Poitrine',1) returning id`, [polo.id]);

const envoiId = crypto.randomUUID();
const deposer = (path, mime) => q(`insert into storage.objects(bucket_id, name, metadata) values ('site-personnalisation',$1,$2)`, [path, { mimetype: mime, size: 1234 }]);
await deposer(`envois/${envoiId}/1-logo.png`, "image/png");
await deposer(`envois/${envoiId}/2-maquette-1.pdf`, "application/pdf");
await deposer(`envois/${envoiId}/3-logo-polo.png`, "image/png");
await deposer(`envois/${envoiId}/4-maquette-2.pdf`, "application/pdf");

const articleTee = { modele_id: tee.id, couleur_id: noir.id, textile_id: tissu.id, quantite: "60", marquages: [{ emplacement_id: poitrineTee.id, largeur_cm: 9, technique_libelle: "Sérigraphie", nb_couleurs: 2, consigne: "Logo cœur" }] };
const articlePolo = { modele_id: polo.id, couleur_id: blanc.id, textile_id: tissu.id, quantite: "24", marquages: [{ emplacement_id: poitrinePolo.id, largeur_cm: 8, technique_libelle: "Broderie", nb_couleurs: 3 }] };
const base = {
  envoi_id: envoiId,
  nom: "Awa Panier", entreprise: "Awa SARL", email: "awa@panier.ci", telephone: "0700000002",
  articles: [articleTee, articlePolo],
  fichiers: [
    { path: `envois/${envoiId}/1-logo.png`, nom: "logo.png", role: "logo", marquage: 1, article: 1 },
    { path: `envois/${envoiId}/2-maquette-1.pdf`, nom: "maquette.pdf", role: "maquette", article: 1 },
    { path: `envois/${envoiId}/3-logo-polo.png`, nom: "logo-polo.png", role: "logo", marquage: 1, article: 2 },
    { path: `envois/${envoiId}/4-maquette-2.pdf`, nom: "maquette.pdf", role: "maquette", article: 2 },
  ],
};

await test("désactivé : refusé, aucune demande", async () => {
  await expectFail(() => demande(base), /personnaliser désactivé/);
  assert.equal((await one(`select count(*)::int n from requests where source='site'`)).n, 0);
});

await q(`update site_settings set eshop_actif = true, personnaliser_actif = true`);

await test("2 articles : UNE demande, composition { articles }, une ligne de devis par article", async () => {
  const r = await demande(base);
  assert.match(r.reference, /^WEB/);
  const rq = await one(`select personnalisation, lignes_stock, prospect, description from requests where id=$1`, [r.id]);
  assert.equal(rq.personnalisation.articles.length, 2);
  assert.equal(rq.personnalisation.envoi_id, envoiId);
  assert.deepEqual(rq.personnalisation.articles.map((a) => [a.modele, a.quantite]), [["Tee P", 60], ["Polo P", 24]]);
  assert.equal(rq.lignes_stock.length, 2);
  assert.deepEqual(rq.lignes_stock.map((l) => [l.product_model_id, l.quantite]), [[tee.id, 60], [polo.id, 24]]);
  assert.deepEqual(rq.lignes_stock[0].impressions, { [poitrineTee.id]: 2 });
  assert.equal(rq.prospect.quantite, "84");
  assert.match(rq.prospect.produit, /^2 articles : /);
  assert.match(rq.description, /Article 1 : Tee P/);
  assert.match(rq.description, /Article 2 : Polo P/);
  assert.equal((await one(`select count(*)::int n from requests where source='site'`)).n, 1);
});

await test("les fichiers sont rangés par article", async () => {
  const f = await q(`select file_name, role, marquage, article from request_site_files order by article, role`);
  assert.deepEqual(f.map((x) => [x.file_name, x.role, x.article]), [
    ["logo.png", "logo", 1], ["maquette.pdf", "maquette", 1], ["logo-polo.png", "logo", 2], ["maquette.pdf", "maquette", 2],
  ]);
});

await test("un seul article : même résultat que le panier, produit sans « 2 articles »", async () => {
  const id2 = crypto.randomUUID();
  await deposer(`envois/${id2}/1-m.pdf`, "application/pdf");
  const r = await demande({ envoi_id: id2, nom: "Solo", email: "solo@panier.ci", telephone: "0700000003", articles: [articleTee], fichiers: [{ path: `envois/${id2}/1-m.pdf`, nom: "m.pdf", role: "maquette" }] });
  const rq = await one(`select personnalisation, prospect from requests where id=$1`, [r.id]);
  assert.equal(rq.personnalisation.articles.length, 1);
  assert.match(rq.prospect.produit, /^Tee P · Noir P · 150 g\/m² ×60$/);
  assert.equal((await one(`select article from request_site_files where request_id=$1`, [r.id])).article, 1);
});

const echec = async (mod, re) => {
  const id = crypto.randomUUID();
  const avant = (await one(`select count(*)::int n from requests where source='site'`)).n;
  await expectFail(() => demande({ ...base, envoi_id: id, fichiers: [], ...mod(id) }), re);
  assert.equal((await one(`select count(*)::int n from requests where source='site'`)).n, avant, "aucune demande créée");
};

await test("article non publié, zéro article, trop d'articles : refusés, rien n'est créé", async () => {
  await echec(() => ({ articles: [{ ...articleTee, modele_id: cache.id }] }), /article non proposé/);
  await echec(() => ({ articles: [] }), /nombre d'articles invalide/);
  await echec(() => ({ articles: Array.from({ length: 11 }, () => articleTee) }), /nombre d'articles invalide/);
});

await test("2e article invalide (emplacement d'un autre modèle) : toute la demande est refusée", async () => {
  await echec(() => ({ articles: [articleTee, { ...articlePolo, marquages: [{ ...articlePolo.marquages[0], emplacement_id: poitrineTee.id }] }] }), /emplacement non proposé/);
});

await test("fichier rattaché à un article inconnu, ou absent du dossier de l'envoi : refusé", async () => {
  const id = crypto.randomUUID();
  await deposer(`envois/${id}/x.pdf`, "application/pdf");
  await expectFail(() => demande({ ...base, envoi_id: id, articles: [articleTee], fichiers: [{ path: `envois/${id}/x.pdf`, nom: "x.pdf", role: "maquette", article: 2 }] }), /article inconnu/);
  await expectFail(() => demande({ ...base, envoi_id: id, articles: [articleTee], fichiers: [{ path: `envois/${envoiId}/1-logo.png`, nom: "x", role: "logo", article: 1 }] }), /fichier introuvable/);
});

await test("l'API publique ne peut pas créer de demande (service_role seul)", async () => {
  await db.exec("set role authenticated");
  try {
    await expectFail(() => q(`select create_site_demande($1::jsonb)`, [JSON.stringify(base)]), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

await test("la fonction à un article d'avant (0121) fonctionne toujours", async () => {
  const id = crypto.randomUUID();
  await deposer(`envois/${id}/m.pdf`, "application/pdf");
  const r = (await site(`select create_site_personnalisation($1::jsonb) r`, [JSON.stringify({ ...articleTee, envoi_id: id, nom: "Ancien", email: "ancien@panier.ci", telephone: "0700000004", fichiers: [{ path: `envois/${id}/m.pdf`, nom: "m.pdf", role: "maquette" }] })]))[0].r;
  const rq = await one(`select personnalisation from requests where id=$1`, [r.id]);
  assert.equal(rq.personnalisation.modele, "Tee P");
  assert.equal((await one(`select article from request_site_files where request_id=$1`, [r.id])).article, null);
});

console.log("OK");
process.exit(0);
