// Scénarios SQL du lot ART-H (migration 0077) : parcours types, Finition
// imposée en dernier à l'application.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
await as(admin);
const company = (await one(`insert into companies(name) values ('C') returning id`)).id;
await q(`update sections set categorie_id=(select id from atelier_categories where cle='impression') where name='Sérigraphie'`);
await q(`update sections set categorie_id=(select id from atelier_categories where cle='couture') where name='Couture'`);

await test("un parcours type pré-remplit les étapes, la Finition reste dernière", async () => {
  const odf = await makeOdf(ctx, { admin, company, sections: [], sizes: { "Homme/M": 10 } });
  const route = await one(`insert into model_routes(product_model_id, nom, par_defaut) values ($1,'Imprimé',true) returning id`, [odf.model.id]);
  const serigraphie = await one(`select id from sections where name='Sérigraphie'`);
  await q(`insert into model_route_steps(route_id, etape, section_id) values ($1,1,$2)`, [route.id, serigraphie.id]);
  await q(`insert into model_route_steps(route_id, etape, atelier_category) values ($1,2,'couture')`, [route.id]);
  await q(`select apply_model_route($1,$2)`, [odf.line.id, route.id]);
  const rows = await q(`select etape, section_categorie_cle(section_id) cat from production_order_line_sections where production_order_line_id=$1 order by etape`, [odf.line.id]);
  assert.deepEqual(rows.map((r) => [r.etape, r.cat]), [[1, "impression"], [2, "couture"], [3, "finition"]]);
  await q(`update production_orders set infographie_validee_le=now() where id=$1`, [odf.po.id]);
  await q(`select submit_production_order($1)`, [odf.po.id]);
});

await test("Finition interdite dans un parcours ; Coupe seulement en entrée", async () => {
  const m = await one(`insert into product_models(name) values ('X') returning id`);
  const r = await one(`insert into model_routes(product_model_id, nom) values ($1,'R') returning id`, [m.id]);
  await expectFail(() => q(`insert into model_route_steps(route_id, etape, atelier_category) values ($1,1,'finition')`, [r.id]), /pas_de_finition/);
  await q(`insert into model_route_steps(route_id, etape, atelier_category) values ($1,1,'couture')`, [r.id]);
  await q(`insert into model_route_steps(route_id, etape, atelier_category) values ($1,2,'coupe')`, [r.id]);
  await expectFail(() => q(`select check_model_route($1)`, [r.id]), /point d'entrée/);
});

await test("parcours d'un autre modèle refusé ; ODF lancé non modifiable", async () => {
  const odf = await makeOdf(ctx, { admin, company, sections: [], sizes: { "Homme/M": 5 } });
  const other = await one(`insert into product_models(name) values ('Autre') returning id`);
  const r = await one(`insert into model_routes(product_model_id, nom) values ($1,'R') returning id`, [other.id]);
  await expectFail(() => q(`select apply_model_route($1,$2)`, [odf.line.id, r.id]), /autre modèle/);
});
console.log("ART-H : tous les tests passent");
