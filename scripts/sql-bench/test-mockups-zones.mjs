// Scénarios SQL (migration 0121) : mockups SVG des articles (correspondance
// des zones, calibrage, repères), catalogue du site et couleurs par zone à
// l'envoi depuis « Personnaliser ».
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
const sauver = (uid, args) =>
  asRole("authenticated", uid, `select save_product_model_mockup($1,$2,$3,$4,$5,$6,$7)`, args);
const catalogue = async () => (await asRole("service_role", null, `select eshop_catalogue() c`))[0].c;
const envoyer = async (p) => (await asRole("service_role", null, `select create_site_personnalisation($1::jsonb) r`, [JSON.stringify(p)]))[0].r;

await q(`update site_settings set eshop_actif = true, personnaliser_actif = true`);
const blanc = await one(`insert into colors(name, code, hex) values ('Blanc Z','BZ','#FFFFFF') returning id`);
const rouge = await one(`insert into colors(name, code, hex) values ('Rouge Z','RZ','#E20B2A') returning id`);
const vert = await one(`insert into colors(name, code, hex) values ('Vert Z','VZ','#00723F') returning id`);
const tee = await one(`insert into product_models(name, nature, publiable_eshop) values ('Tee Z','pf',true) returning id`);
for (const c of [blanc, rouge]) await q(`insert into product_model_colors values ($1,$2)`, [tee.id, c.id]);
await q(
  `insert into product_zone_templates(product_model_id, zone_key, zone_label, display_order) values
   ($1,'corps_avant','Corps avant',1), ($1,'col','Col',2), ($1,'manche_gauche','Manche gauche',3)`,
  [tee.id],
);
const poitrine = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'poitrine','Poitrine',1) returning id`, [tee.id]);
const autre = await one(`insert into product_models(name, nature) values ('Autre Z','pf') returning id`);
const zoneAutre = await one(`insert into product_printable_zones(product_model_id, zone_key, zone_label, display_order) values ($1,'dos','Dos',1) returning id`, [autre.id]);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 440"><g id="corps_avant"><path d="M0 0"/></g><path id="col" d="M1 1"/></svg>`;
const zones = { corps_avant: "corps_avant", col: "col", ombre: "__contour" };
const cadre = { x: 100, y: 40, w: 200, h: 380 };

await test("seuls les rôles qui modifient les articles déposent un mockup", async () => {
  await expectFail(() => sauver(commercial, [tee.id, "avant", svg, zones, 52, cadre, {}]), /accès refusé/);
  await sauver(admin, [tee.id, "avant", svg, zones, null, null, {}]);
  assert.equal((await one(`select count(*)::int n from product_model_mockups where product_model_id=$1`, [tee.id])).n, 1);
});

await test("contrôles : zone de couleur, zone d'impression d'un autre modèle, vue, cadre", async () => {
  await expectFail(() => sauver(admin, [tee.id, "avant", svg, { x: "poche" }, 52, cadre, {}]), /zone de couleur inconnue/);
  await expectFail(() => sauver(admin, [tee.id, "avant", svg, zones, 52, cadre, { [zoneAutre.id]: { x: 1, y: 1 } }]), /zone d'impression inconnue/);
  await expectFail(() => sauver(admin, [tee.id, "cote", svg, zones, 52, cadre, {}]), /vue inconnue/);
  await expectFail(() => sauver(admin, [tee.id, "avant", "<div/>", zones, 52, cadre, {}]), /SVG invalide/);
  await expectFail(() => sauver(admin, [tee.id, "avant", svg, zones, 52, { x: 0, y: 0, w: 0, h: 5 }, {}]), /cadre/);
});

await test("catalogue : zones de couleur toujours, mockup seulement une fois calibré", async () => {
  let m = (await catalogue()).find((x) => x.id === tee.id);
  assert.deepEqual(m.zones_couleur.map((z) => z.cle), ["corps_avant", "col", "manche_gauche"]);
  assert.deepEqual(m.mockups, []);
  await sauver(admin, [tee.id, "avant", svg, zones, 52, cadre, { [poitrine.id]: { x: 200, y: 160 } }]);
  m = (await catalogue()).find((x) => x.id === tee.id);
  assert.equal(m.mockups.length, 1);
  assert.equal(m.mockups[0].vue, "avant");
  assert.equal(Number(m.mockups[0].largeur_cm), 52);
  assert.deepEqual(m.mockups[0].reperes[poitrine.id], { x: 200, y: 160 });
});

const base = {
  envoi_id: crypto.randomUUID(),
  nom: "Zoé Zones",
  email: "zoe@zones.ci",
  telephone: "0700000002",
  modele_id: tee.id,
  couleur_id: blanc.id,
  quantite: "40",
  marquages: [{ emplacement_id: poitrine.id, largeur_cm: 9, nb_couleurs: 1 }],
  fichiers: [],
};

await test("envoi avec couleurs par zone : demande et devis en « couleur par zone »", async () => {
  const r = await envoyer({ ...base, couleurs_zones: { corps_avant: blanc.id, col: rouge.id } });
  const d = await one(`select lignes_stock, personnalisation, description from requests where id=$1`, [r.id]);
  const [ligne] = d.lignes_stock;
  assert.equal(ligne.couleur_unique_id, undefined);
  assert.deepEqual(ligne.couleurs_zones, { corps_avant: blanc.id, col: rouge.id });
  assert.equal(d.personnalisation.couleurs_zones.col.couleur, "Rouge Z");
  assert.match(d.description, /Couleurs par zone : .*Col Rouge Z/);
});

await test("couleur par zone : zone d'un autre modèle ou couleur non proposée refusées", async () => {
  await expectFail(() => envoyer({ ...base, envoi_id: crypto.randomUUID(), couleurs_zones: { poche: blanc.id } }), /zone de couleur non proposée/);
  await expectFail(() => envoyer({ ...base, envoi_id: crypto.randomUUID(), couleurs_zones: { col: vert.id } }), /couleur non proposée/);
});

await test("sans couleur par zone : couleur unique, comme avant", async () => {
  const r = await envoyer({ ...base, envoi_id: crypto.randomUUID(), email: "uni@zones.ci" });
  const d = await one(`select lignes_stock from requests where id=$1`, [r.id]);
  assert.equal(d.lignes_stock[0].couleur_unique_id, blanc.id);
  assert.equal(d.lignes_stock[0].couleurs_zones, undefined);
});

await test("suppression d'un mockup réservée aux mêmes rôles", async () => {
  await expectFail(() => asRole("authenticated", commercial, `select delete_product_model_mockup($1,'avant')`, [tee.id]), /accès refusé/);
  await asRole("authenticated", admin, `select delete_product_model_mockup($1,'avant')`, [tee.id]);
  assert.equal((await one(`select count(*)::int n from product_model_mockups where product_model_id=$1`, [tee.id])).n, 0);
});
