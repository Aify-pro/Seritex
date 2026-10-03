// Scénarios SQL du lot ART-C (migration 0080) : surfaces de tissu, composant
// calculé, confidentialité (Direction et administrateur seulement).
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
const model = await one(`insert into product_models(name) values ('T') returning id`);

async function asAuth(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

await test("surfaces par taille : Direction seulement", async () => {
  await asAuth(admin, `insert into model_size_fabric_area(product_model_id, taille, surface_m2, source) values ($1,'Homme/M',0.55,'saisie')`, [model.id]);
  assert.equal((await asAuth(commercial, `select count(*)::int n from model_size_fabric_area`))[0].n, 0);
  await expectFail(() => asAuth(commercial, `insert into model_size_fabric_area(product_model_id, taille, surface_m2) values ($1,'Homme/L',0.6)`, [model.id]), /row-level security/);
  await expectFail(() => q(`insert into model_size_fabric_area(product_model_id, taille, surface_m2) values ($1,'Homme/M',0.6)`, [model.id]), /unique/);
});

await test("composant calculé : mode et chutes enregistrés, défaut « saisi »", async () => {
  const c = await one(`insert into model_cost_components(product_model_id, libelle, base) values ($1,'Col',30) returning mode_calcul, perte_pct`, [model.id]);
  assert.deepEqual([c.mode_calcul, Number(c.perte_pct)], ["saisi", 0]);
  await q(`insert into model_cost_components(product_model_id, libelle, base, mode_calcul, perte_pct, est_tissu) values ($1,'Tissu',0,'tissu_calcule',8,true)`, [model.id]);
  await expectFail(() => q(`insert into model_cost_components(product_model_id, libelle, base, mode_calcul) values ($1,'X',0,'autre')`, [model.id]), /check/);
});

await test("proposition depuis la fiche de placement : surface du matelas / pièces par couche", async () => {
  await as(admin);
  const fiche = await one(`insert into fiches_placement(numero_ot, product_model_id) values ('OT-T-1',$1) returning id`, [model.id]);
  await q(`insert into traces_placement(fiche_id, ordre, reference, longueur_matelas_cm, largeur_matelas_cm, repartition_par_couche) values ($1,1,'T1',600,180,'{"Homme/M":10,"Homme/L":10}')`, [fiche.id]);
  // 600 × 180 cm = 10,8 m² pour 20 pièces : 0,54 m² par pièce.
  assert.equal(Number((await one(`select propose_fabric_area_from_placement($1) s`, [model.id])).s), 0.54);
  await as(commercial);
  assert.equal((await one(`select propose_fabric_area_from_placement($1) s`, [model.id])).s, null);
});
console.log("ART-C : tous les tests passent");
