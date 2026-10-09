// Scénarios SQL (migration 0110) : interrupteur du site (e-shop / Personnaliser)
// et envoi d'une composition depuis l'outil « Personnaliser ».
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
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
const reglages = async () => (await site(`select site_reglages() r`))[0].r;
const catalogue = async () => (await site(`select eshop_catalogue() c`))[0].c;
const envoyer = async (p) => (await site(`select create_site_personnalisation($1::jsonb) r`, [JSON.stringify(p)]))[0].r;
const regler = (uid, e, p, m = null) => asRole("authenticated", uid, `select set_site_settings($1, $2, $3)`, [e, p, m]);

// Un modèle publiable : tissu 150, deux couleurs, une taille, deux emplacements.
const tissu = await one(`insert into textiles(nom, grammage) values ('Jersey S 150',150) returning id`);
const blanc = await one(`insert into colors(name, code, hex) values ('Blanc S','BS','#FFFFFF') returning id`);
const noir = await one(`insert into colors(name, code, hex) values ('Noir S','NS','#000000') returning id`);
const autre = await one(`insert into colors(name, code) values ('Rose S','RS') returning id`);
const tee = await one(`insert into product_models(name, nature, publiable_eshop) values ('Tee S','pf',true) returning id`);
await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [tee.id, tissu.id]);
for (const c of [blanc, noir]) await q(`insert into product_model_colors values ($1,$2)`, [tee.id, c.id]);
const taille = await one(`select id, cle from sizes where active order by display_order limit 1`);
await q(`insert into product_model_sizes values ($1,$2)`, [tee.id, taille.id]);
const poitrine = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'poitrine','Poitrine',1) returning id`, [tee.id]);
const dos = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'dos','Dos',2) returning id`, [tee.id]);

const envoiId = crypto.randomUUID();
const deposer = (path, mime) => q(`insert into storage.objects(bucket_id, name, metadata) values ('site-personnalisation',$1,$2)`, [path, { mimetype: mime, size: 1234 }]);
const base = {
  envoi_id: envoiId,
  nom: "Awa Prospect",
  entreprise: "Awa SARL",
  email: "awa@prospect.ci",
  telephone: "0700000001",
  modele_id: tee.id,
  couleur_id: noir.id,
  textile_id: tissu.id,
  quantite: "60",
  marquages: [
    { emplacement_id: poitrine.id, largeur_cm: 9, technique_libelle: "Sérigraphie", nb_couleurs: 2, consigne: "Logo cœur" },
    { emplacement_id: dos.id, largeur_cm: 29.7, technique_libelle: "Impression numérique", nb_couleurs: 40 },
  ],
  fichiers: [
    { path: `envois/${envoiId}/logo-1.png`, nom: "logo.png", role: "logo", marquage: 1 },
    { path: `envois/${envoiId}/maquette.pdf`, nom: "maquette.pdf", role: "maquette" },
  ],
};

await test("au départ : e-shop et Personnaliser désactivés, catalogue vide", async () => {
  assert.deepEqual(await reglages(), { eshop: false, personnaliser: false, message: null });
  assert.deepEqual(await catalogue(), []);
});

await test("désactivé : la base refuse l'envoi, aucune demande créée", async () => {
  await expectFail(() => envoyer(base), /personnaliser désactivé/);
  assert.equal((await one(`select count(*)::int n from requests where source='site'`)).n, 0);
});

await test("seuls l'administrateur et la Direction règlent le site (le commercial non)", async () => {
  await expectFail(() => regler(commercial, true, true), /accès refusé/);
  await regler(admin, true, false, "Boutique fermée pour inventaire");
  assert.deepEqual(await reglages(), { eshop: true, personnaliser: false, message: "Boutique fermée pour inventaire" });
  assert.equal((await catalogue()).length, 1);
  const log = await one(`select metadata from audit_log where action='set_site_settings' order by occurred_at desc limit 1`);
  assert.equal(log.metadata.apres.eshop, true);
});

await test("Personnaliser dépend de l'e-shop : e-shop coupé = tout coupé", async () => {
  await regler(admin, false, true);
  assert.deepEqual(await reglages(), { eshop: false, personnaliser: false, message: null });
  await expectFail(() => envoyer(base), /personnaliser désactivé/);
  await regler(admin, true, true);
  assert.equal((await reglages()).personnaliser, true);
});

await test("un fichier qui n'a pas été déposé dans le dossier de l'envoi est refusé", async () => {
  await expectFail(() => envoyer(base), /fichier introuvable/);
  await deposer(`envois/${crypto.randomUUID()}/intrus.png`, "image/png");
  await expectFail(
    () => envoyer({ ...base, fichiers: [{ path: `envois/${crypto.randomUUID()}/intrus.png`, nom: "x", role: "logo" }] }),
    /fichier introuvable/,
  );
});

await test("contrôles : article non publié, couleur, emplacement d'un autre modèle", async () => {
  const cache = await one(`insert into product_models(name, nature) values ('Caché S','pf') returning id`);
  await expectFail(() => envoyer({ ...base, fichiers: [], modele_id: cache.id }), /article non proposé/);
  await expectFail(() => envoyer({ ...base, fichiers: [], couleur_id: autre.id }), /couleur non proposée/);
  const zoneAutre = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'dos','Dos',1) returning id`, [cache.id]);
  await expectFail(() => envoyer({ ...base, fichiers: [], marquages: [{ emplacement_id: zoneAutre.id, largeur_cm: 9 }] }), /emplacement non proposé/);
  await expectFail(() => envoyer({ ...base, fichiers: [], quantite: "0" }), /quantité invalide/);
});

let demande;
await test("envoi complet : demande « Client à rattacher », article repris par le devis, fichiers rattachés", async () => {
  await deposer(`envois/${envoiId}/logo-1.png`, "image/png");
  await deposer(`envois/${envoiId}/maquette.pdf`, "application/pdf");
  const r = await envoyer(base);
  assert.match(r.reference, /^WEB-\d{4}-\d{4}$/);
  assert.equal(r.client_reconnu, false);
  demande = await one(`select * from requests where id=$1`, [r.id]);
  assert.equal(demande.source, "site");
  assert.equal(demande.company_id, null);
  assert.equal(demande.prospect.email, "awa@prospect.ci");
  assert.match(demande.description, /Personnaliser[\s\S]*Marquage 1 : Poitrine · 9 cm · Sérigraphie · « Logo cœur »[\s\S]*Marquage 2 : Dos/);
  const [ligne] = demande.lignes_stock;
  assert.equal(ligne.product_model_id, tee.id);
  assert.equal(ligne.couleur_unique_id, noir.id);
  assert.equal(ligne.textile_id, tissu.id);
  assert.equal(ligne.quantite, 60);
  // Nombre de couleurs borné à 12 (dégradé → 40 détectées).
  assert.deepEqual(ligne.impressions, { [poitrine.id]: 2, [dos.id]: 12 });
  assert.equal(demande.personnalisation.couleur, "Noir S");
  const files = await q(`select role, marquage, mime_type from request_site_files where request_id=$1 order by role`, [r.id]);
  assert.deepEqual(files, [
    { role: "logo", marquage: 1, mime_type: "image/png" },
    { role: "maquette", marquage: null, mime_type: "application/pdf" },
  ]);
});

await test("répartition par taille : la quantité devient la somme, tailles inconnues ignorées", async () => {
  const e = crypto.randomUUID();
  const r = await envoyer({ ...base, envoi_id: e, email: "b@prospect.ci", fichiers: [], quantite: "999", repartition: { [taille.cle]: "25", "inconnue/ZZ": "10" } });
  const d = await one(`select lignes_stock from requests where id=$1`, [r.id]);
  assert.equal(d.lignes_stock[0].quantite, 25);
  assert.deepEqual(d.lignes_stock[0].tailles, { [taille.cle]: 25 });
});

await test("deux visuels sur le même emplacement (cœur + ventre) : le devis garde le plus grand nombre de couleurs", async () => {
  const e = crypto.randomUUID();
  const r = await envoyer({
    ...base,
    envoi_id: e,
    email: "c@prospect.ci",
    fichiers: [],
    marquages: [
      { emplacement_id: poitrine.id, largeur_cm: 9, technique_libelle: "Sérigraphie", nb_couleurs: 4, decalage_y_cm: -6 },
      { emplacement_id: poitrine.id, largeur_cm: 25, technique_libelle: "Sérigraphie", nb_couleurs: 2, decalage_y_cm: 8 },
    ],
  });
  const d = await one(`select lignes_stock, personnalisation, description from requests where id=$1`, [r.id]);
  assert.deepEqual(d.lignes_stock[0].impressions, { [poitrine.id]: 4 });
  assert.equal(d.personnalisation.marquages.length, 2);
  assert.match(d.description, /Marquage 1 : Poitrine[\s\S]*Marquage 2 : Poitrine · 25 cm/);
});

await test("fichiers visibles par qui voit la demande : commercial oui, anonyme non", async () => {
  const vus = await asRole("authenticated", commercial, `select count(*)::int n from request_site_files where request_id=$1`, [demande.id]);
  assert.equal(vus[0].n, 2);
  await expectFail(() => asRole("anon", null, `select count(*) from request_site_files`), /permission denied/);
});

await test("couper le site ne touche pas aux demandes déjà reçues", async () => {
  await regler(admin, false, false);
  assert.equal((await one(`select count(*)::int n from requests where source='site'`)).n, 3);
  assert.deepEqual(await catalogue(), []);
});

await test("site_reglages et l'envoi sont réservés au serveur du site", async () => {
  await expectFail(() => asRole("anon", null, `select site_reglages()`), /permission denied/);
  await expectFail(() => asRole("authenticated", commercial, `select create_site_personnalisation('{}'::jsonb)`), /permission denied/);
});
