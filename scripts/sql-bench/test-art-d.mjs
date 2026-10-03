// Scénarios SQL du lot ART-D (migration 0083) : prix de vente par grammage et
// par taille sans aucun coût, coefficient imposé, grammage recopié du devis à
// l'ODF puis utilisé pour trouver la déclinaison.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
const client = await one(`insert into companies(name) values ('Client D') returning id`);
const clientUser = await mkUser("client", { company_id: client.id });
const cat = await one(`insert into product_categories(nom, code_court) values ('T-shirt','TS') returning id`);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const model = await one(`insert into product_models(name, categorie_id, matiere_id) values ('T-shirt D',$1,$2) returning id`, [cat.id, jersey.id]);
const t165 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 165 D',165,$1,'165') returning id`, [jersey.id]);
const t200 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 200 D',200,$1,'200') returning id`, [jersey.id]);
const M = await one(`select id, cle from sizes where cle='Homme/M'`);
const L = await one(`select id, cle from sizes where cle='Homme/L'`);
await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2),($1,$3)`, [model.id, t165.id, t200.id]);
await q(`insert into product_model_sizes(product_model_id, size_id) values ($1,$2),($1,$3)`, [model.id, M.id, L.id]);
await q(`insert into textile_prices(textile_id, prix_kg) values ($1,3000),($2,3000)`, [t165.id, t200.id]);
await q(`insert into model_size_fabric_area(product_model_id, taille, surface_m2) values ($1,'Homme/M',0.5),($1,'Homme/L',0.6)`, [model.id]);
const tissu = await one(`insert into model_cost_components(product_model_id, libelle, base, mode_calcul, est_tissu) values ($1,'Tissu',0,'tissu_calcule',true) returning id`, [model.id]);
const conf = await one(`insert into model_cost_components(product_model_id, libelle, base) values ($1,'Confection',150) returning id`, [model.id]);
await q(`insert into model_cost_supplements(component_id, taille, supplement) values ($1,'Homme/L',50)`, [conf.id]);

const prices = async (uid) => {
  await as(uid);
  return q(`select * from model_sale_prices($1) order by grammage, taille`, [model.id]);
};
const pv = (rows, g, cle) => rows.find((r) => Number(r.grammage) === g && r.taille === cle);

await test("prix de vente par grammage et taille, même formule que la grille (tissu calculé)", async () => {
  const rows = await prices(commercial);
  assert.equal(rows.length, 4);
  const coef = 1 / (0.6 * 0.85);
  // 165 g, M : 0,5 × 0,165 × 3 000 + 150 = 397,5 → × 1,96 = 779,4 → 800.
  assert.equal(Number(pv(rows, 165, "Homme/M").prix_vente), Math.ceil((0.5 * 0.165 * 3000 + 150) * coef / 100) * 100);
  assert.equal(Number(pv(rows, 200, "Homme/L").prix_vente), Math.ceil((0.6 * 0.2 * 3000 + 200) * coef / 100 - 1e-9) * 100);
  assert.ok(Number(pv(rows, 200, "Homme/M").prix_vente) >= Number(pv(rows, 165, "Homme/M").prix_vente));
  // Aucun coût ni marge dans le résultat.
  assert.deepEqual(Object.keys(rows[0]).sort(), ["grammage", "manquant", "prix_vente", "source", "taille", "textile_id", "textile_nom"]);
});

await test("prix forcé et coefficient imposé", async () => {
  await q(`insert into model_forced_prices(product_model_id, taille, prix, textile_id) values ($1,'Homme/M',2500,$2)`, [model.id, t200.id]);
  let rows = await prices(commercial);
  assert.equal(Number(pv(rows, 200, "Homme/M").prix_vente), 2500);
  assert.equal(pv(rows, 200, "Homme/M").source, "force");
  assert.equal(pv(rows, 165, "Homme/M").source, "calcule");
  await q(`update pricing_settings set coef_prix_vente = 2`);
  rows = await prices(commercial);
  assert.equal(Number(pv(rows, 165, "Homme/M").prix_vente), 800); // 397,5 × 2 = 795 → 800
  // Un modèle avec sa propre marge garde la formule.
  await q(`insert into model_pricing(product_model_id, marge_pct) values ($1, 15)`, [model.id]);
  rows = await prices(commercial);
  assert.equal(Number(pv(rows, 165, "Homme/M").prix_vente), Math.ceil(397.5 / (0.6 * 0.85) / 100) * 100);
  await q(`update pricing_settings set coef_prix_vente = null`);
  await expectFail(() => q(`update pricing_settings set coef_prix_vente = 0`), /check/);
});

await test("donnée manquante : prix nul et motif, jamais 0", async () => {
  await q(`delete from textile_prices where textile_id=$1`, [t165.id]);
  const rows = await prices(commercial);
  assert.equal(pv(rows, 165, "Homme/L").prix_vente, null);
  assert.match(pv(rows, 165, "Homme/L").manquant, /tissu incomplet/);
  await q(`insert into textile_prices(textile_id, prix_kg) values ($1,3000)`, [t165.id]);
});

await test("réservé au personnel : un client ne lit pas les prix de la grille", async () => {
  await expectFail(() => prices(clientUser), /accès refusé/);
});

await test("devis accepté : grammage recopié sur la ligne d'ODF, demande sur l'ODF, déclinaison trouvée", async () => {
  await as(null); // données posées hors session (pas de garde de validation interne)
  const blanc = await one(`insert into colors(name, code) values ('Blanc D','#fff') returning id`);
  const req = await one(`insert into requests(reference, company_id) values ('DEM-D-1',$1) returning id`, [client.id]);
  const quote = await one(`insert into quotes(reference, request_id, company_id, status) values ('DEV-D-1',$1,$2,'envoye') returning id`, [req.id, client.id]);
  const ql = await one(
    `insert into quote_lines(quote_id, product_model_id, description, quantity, unit_price, couleur_unique_id, textile_id) values ($1,$2,'T-shirt 200',10,900,$3,$4) returning id`,
    [quote.id, model.id, blanc.id, t200.id]
  );
  await q(`insert into quote_line_sizes(quote_line_id, taille, quantite) values ($1,'Homme/M',10)`, [ql.id]);
  await as(admin);
  const po = (await one(`select accept_quote($1) id`, [quote.id])).id;
  const o = await one(`select request_id from production_orders where id=$1`, [po]);
  assert.equal(o.request_id, req.id);
  const line = await one(`select id, textile_id from production_order_lines where production_order_id=$1`, [po]);
  assert.equal(line.textile_id, t200.id);
  // Deux grammages autorisés : sans le grammage de la ligne, aucune déclinaison n'était déterminable.
  await q(`insert into product_model_colors(product_model_id, color_id) values ($1,$2)`, [model.id, blanc.id]);
  await as(admin);
  await q(`select ensure_variants($1)`, [model.id]);
  const v = await one(`select pv.textile_id from product_variants pv where pv.id = line_variant_id($1,'Homme/M')`, [line.id]);
  assert.equal(v.textile_id, t200.id);
});

await test("mémoire des prix client : grammage repris de la ligne du devis", async () => {
  const quote = await one(`select quote_id from quote_lines where textile_id=$1 limit 1`, [t200.id]);
  await as(null);
  await q(`insert into client_model_prices(company_id, product_model_id, taille, prix_xof, quote_id) values ($1,$2,'Homme/M',900,$3)`, [client.id, model.id, quote.quote_id]);
  assert.equal((await one(`select textile_id from client_model_prices where company_id=$1`, [client.id])).textile_id, t200.id);
});

console.log("ART-D : tous les tests passent");
