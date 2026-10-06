// Scénarios SQL du lot COM-0 (migration 0076) : codification, déclinaisons,
// articles stockables vierge / personnalisé / 2e choix.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { q, one, as, mkUser, expectFail } = await setup();
const admin = await mkUser("administrateur");
await as(admin);

const cat = await one(`insert into product_categories(nom, code_court) values ('T-shirt','TS') returning id`);
const jersey = await one(`insert into matieres(nom, code_court) values ('Jersey','JE') returning id`);
const pique = await one(`insert into matieres(nom, code_court) values ('Piqué','PI') returning id`);
const t165 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 165',165,$1,'165') returning id`, [jersey.id]);
const t180 = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Jersey 180',180,$1,'180') returning id`, [jersey.id]);
const tPique = await one(`insert into textiles(nom, grammage, matiere_id, code_court) values ('Piqué 220',220,$1,'220') returning id`, [pique.id]);
const blanc = await one(`insert into colors(name, code) values ('Blanc', '#FFFFFF') on conflict (name) do update set name = excluded.name returning id, code_court`);
const noir = await one(`insert into colors(name, code) values ('Noir', '#000000') on conflict (name) do update set name = excluded.name returning id, code_court`);
const xl = await one(`select id, code_court from sizes where cle='Homme/XL'`);
const m = await one(`select id from sizes where cle='Homme/M'`);

let model;
await test("code du modèle attribué par catégorie (TS001, TS002…) et figé", async () => {
  await one(`insert into product_models(name, categorie_id, matiere_id) values ('Basique', $1, $2) returning code`, [cat.id, jersey.id]);
  model = await one(`insert into product_models(name, categorie_id, matiere_id) values ('Col rond', $1, $2) returning id, code, category`, [cat.id, jersey.id]);
  assert.equal(model.code, "TS002");
  assert.equal(model.category, "T-shirt");
  await expectFail(() => q(`update product_models set code='TS999' where id=$1`, [model.id]), /figé/);
});

await test("codes courts par défaut : couleur 3 lettres, taille", async () => {
  assert.equal(blanc.code_court, "BLA");
  assert.equal(noir.code_court, "NOI");
  assert.equal(xl.code_court, "XL");
});

await test("textiles autorisés : forcément de la matière du modèle", async () => {
  await q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2),($1,$3)`, [model.id, t165.id, t180.id]);
  await expectFail(() => q(`insert into product_model_textiles(product_model_id, textile_id) values ($1,$2)`, [model.id, tPique.id]), /matière du modèle/);
});

await test("format TS002JE165BLAXL, ≤ 18 caractères suffixe compris", async () => {
  const c = await one(`select generate_variant_code($1,$2,$3,$4) c`, [model.id, t165.id, blanc.id, xl.id]);
  assert.equal(c.c, "TS002JE165BLAXL");
  await q(`update coding_rules set longueur_max = 15 where nature = 'pf'`);
  await expectFail(() => q(`select generate_variant_code($1,$2,$3,$4)`, [model.id, t165.id, blanc.id, xl.id]), /dépasse la longueur maximale/);
  await q(`update coding_rules set longueur_max = 18 where nature = 'pf'`);
});

await test("une seule déclinaison par combinaison ; vierge, P et D distincts", async () => {
  await q(`insert into product_model_colors values ($1,$2),($1,$3)`, [model.id, blanc.id, noir.id]);
  await q(`insert into product_model_sizes values ($1,$2),($1,$3)`, [model.id, xl.id, m.id]);
  const n = await one(`select ensure_variants($1) n`, [model.id]);
  assert.equal(n.n, 8);
  assert.equal((await one(`select ensure_variants($1) n`, [model.id])).n, 0);
  const v = await one(`select id, code from product_variants where model_id=$1 and textile_id=$2 and color_id=$3 and size_id=$4`, [model.id, t165.id, blanc.id, xl.id]);
  const arts = await q(`select etat, code from variant_stock_articles where variant_id=$1 order by etat`, [v.id]);
  assert.deepEqual(arts.map((a) => [a.etat, a.code]), [
    ["deuxieme_choix", "TS002JE165BLAXLD"],
    ["personnalise", "TS002JE165BLAXLP"],
    ["vierge", "TS002JE165BLAXL"],
  ]);
  await expectFail(() => q(`insert into product_variants(model_id,textile_id,color_id,size_id,code) values ($1,$2,$3,$4,'X')`, [model.id, t165.id, blanc.id, xl.id]), /combinaison_unique/);
  await expectFail(() => q(`delete from product_variants where id=$1`, [v.id]), /ne se supprime pas/);
  await expectFail(() => q(`update product_variants set code='X' where id=$1`, [v.id]), /figé/);
});

await test("combinaison décochée : désactivée, jamais supprimée", async () => {
  await q(`delete from product_model_colors where product_model_id=$1 and color_id=$2`, [model.id, noir.id]);
  await q(`select ensure_variants($1)`, [model.id]);
  const r = await one(`select count(*) filter (where actif)::int a, count(*)::int t from product_variants where model_id=$1`, [model.id]);
  assert.deepEqual([r.a, r.t], [4, 8]);
});

await test("segment manquant : message explicite", async () => {
  const sans = await one(`insert into product_models(name, matiere_id) values ('Sans catégorie', $1) returning id`, [jersey.id]);
  await expectFail(() => q(`select generate_variant_code($1,$2,$3,$4)`, [sans.id, t165.id, blanc.id, xl.id]), /segment « modele »/);
});

await test("check_sage_reference avertit d'une référence absente du miroir", async () => {
  await q(`insert into sage_articles_view(sage_reference, designation) values ('TSB165BLXL','TS blanc 165 XL')`);
  assert.equal((await one(`select * from check_sage_reference('TSB165BLXL')`)).trouvee, true);
  assert.equal((await one(`select * from check_sage_reference('INCONNU')`)).trouvee, false);
});
console.log("COM-0 : tous les tests passent");
