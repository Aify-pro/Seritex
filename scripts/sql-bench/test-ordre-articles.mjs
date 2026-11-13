// Scénarios SQL de la migration 0181 : articles saisis sans ODF sur un ordre
// de tracé, même type de tissu (grammage et couleur libres), couches et plis,
// pas de « Bon pour coupe » sur un article saisi, remplacement par l'ODF.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client articles') returning id`)).id;
await as(admin);

// Tissus : Jersey en 160 g et 180 g (même type), Piqué 200 g (autre type).
const jersey = await one(`insert into product_models(name, nature) values ('Jersey OA','mp') returning id`);
const pique = await one(`insert into product_models(name, nature) values ('Pique OA','mp') returning id`);
const j160 = await one(`insert into textiles(nom, grammage, product_model_id) values ('Jersey OA 160',160,$1) returning id`, [jersey.id]);
const j180 = await one(`insert into textiles(nom, grammage, product_model_id) values ('Jersey OA 180',180,$1) returning id`, [jersey.id]);
const p200 = await one(`insert into textiles(nom, grammage, product_model_id) values ('Pique OA 200',200,$1) returning id`, [pique.id]);
const blanc = await one(`insert into colors(name, code) values ('OABlanc','OAB') returning id`);
const bleu = await one(`insert into colors(name, code) values ('OABleu','OAU') returning id`);

const manche = await one(`insert into product_models(name, nature) values ('Manche OA','semi_fini') returning id`);
const corps = await one(`insert into product_models(name, nature) values ('Corps OA','semi_fini') returning id`);
async function modele(nom, textile) {
  const m = await one(`insert into product_models(name, textile_id) values ($1,$2) returning id`, [nom, textile.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',2,'',$2),($1,'',1,'',$3)`, [m.id, manche.id, corps.id]);
  return m;
}
const tshirt = await modele("T-shirt OA", j180);
const polo = await modele("Polo OA", p200);

const fiche = await one(`insert into fiches_placement(regroupee, designation_article) values (true,'Ordre sans ODF') returning id, numero_ot`);
let blancArt, bleuArt;

await test("articles saisis : même tissu, grammage et couleur libres ; un autre tissu est refusé", async () => {
  blancArt = await one(`insert into ordre_trace_articles(fiche_id, product_model_id, couleur_unique_id, tailles) values ($1,$2,$3,$4::jsonb) returning id`,
    [fiche.id, tshirt.id, blanc.id, JSON.stringify({ [M]: 10 })]);
  bleuArt = await one(`insert into ordre_trace_articles(fiche_id, product_model_id, textile_id, couleur_unique_id, tailles) values ($1,$2,$3,$4,$5::jsonb) returning id`,
    [fiche.id, tshirt.id, j160.id, bleu.id, JSON.stringify({ [M]: 6 })]);
  await expectFail(
    () => q(`insert into ordre_trace_articles(fiche_id, product_model_id, tailles) values ($1,$2,'{}'::jsonb)`, [fiche.id, polo.id]),
    /« Polo OA » est en Pique OA : cet ordre de tracé est en Jersey OA/
  );
  const c = await q(`select couleur, quantite from couleurs_pieces_articles($1) where semi_fini_nom='Manche OA' order by couleur`, [[blancArt.id, bleuArt.id]]);
  assert.deepEqual(c.map((x) => [x.couleur, Number(x.quantite)]), [["OABlanc", 2], ["OABleu", 2]]);
});

let trace;
await test("couches des articles saisis : plis = leur somme ; pas de « Bon pour coupe »", async () => {
  trace = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OA-T1') returning id`, [fiche.id]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,2)`, [trace.id, manche.id, M]);
  await q(`insert into trace_couches_articles(trace_id, article_id, nb_couches) values ($1,$2,10),($1,$3,6)`, [trace.id, blancArt.id, bleuArt.id]);
  assert.equal((await one(`select nb_plis from traces_placement where id=$1`, [trace.id])).nb_plis, 16);
  await expectFail(() => q(`update traces_placement set statut='bon_pour_coupe' where id=$1`, [trace.id]), /articles saisis sans ODF/);
});

await test("ODF d'un autre tissu : refusé dans l'ordre", async () => {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 5 } });
  await q(`update production_order_lines set product_model_id=$1 where id=$2`, [polo.id, o.line.id]);
  await expectFail(() => q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fiche.id, o.line.id]), /cet ordre de tracé est en Jersey OA/);
});

// 0183 : les couches de l'article saisi ne sont pas reportées (la couleur ou
// le grammage de l'ODF peut différer) : les plis par couleur se réenregistrent.
await test("l'ODF arrive : l'article saisi est remplacé par l'article d'ODF", async () => {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 10 } });
  await q(`update production_order_lines set product_model_id=$1, textile_id=$2 where id=$3`, [tshirt.id, j180.id, o.line.id]);
  await q(`select remplacer_article_ordre($1,$2)`, [blancArt.id, o.line.id]);
  assert.equal((await one(`select count(*)::int n from coupe_groupee_lignes where fiche_id=$1 and production_order_line_id=$2`, [fiche.id, o.line.id])).n, 1);
  assert.equal((await one(`select count(*)::int n from ordre_trace_articles where id=$1`, [blancArt.id])).n, 0);
  assert.equal((await one(`select count(*)::int n from trace_couches_articles where article_id=$1`, [blancArt.id])).n, 0);
  // Un autre modèle ne remplace pas l'article saisi.
  const p = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 6 } });
  await expectFail(() => q(`select remplacer_article_ordre($1,$2)`, [bleuArt.id, p.line.id]), /pas du même modèle/);
});

console.log("Ordre de tracé, articles saisis : tous les tests passent");
