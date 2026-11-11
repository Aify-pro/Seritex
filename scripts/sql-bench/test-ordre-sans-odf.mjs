// Ordre de tracé créé avant l'ODF (2026-11-11) : un ordre regroupé par
// pièces sans article d'ODF reçoit ses tracés et leurs pièces ; il faut au
// moins un article d'ODF rattaché (couches attribuées) pour passer un tracé
// « Bon pour coupe ». Aucune migration : ce scénario fixe le comportement.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client sans ODF') returning id`)).id;
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche SO','semi_fini') returning id`);
const fiche = await one(`insert into fiches_placement(regroupee, designation_article, client_libelle) values (true,'Manches T-shirt','Client sans ODF') returning id, numero_ot, statut`);
let trace;

await test("ordre sans ODF : création, tracé et pièces", async () => {
  assert.equal(fiche.statut, "demande");
  trace = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,$2) returning id, statut`, [fiche.id, `${fiche.numero_ot}-T1`]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,4)`, [trace.id, manche.id, M]);
  await q(`update traces_placement set longueur_matelas_cm=600, largeur_matelas_cm=180 where id=$1`, [trace.id]);
  assert.equal((await one(`select count(*)::int n from trace_semi_finis where trace_id=$1`, [trace.id])).n, 1);
});

await test("sans ODF rattaché : le tracé ne passe pas « Bon pour coupe »", async () => {
  await expectFail(() => q(`select valider_trace($1,'x')`, [trace.id]), /attribuez les couches de ce tracé regroupé aux articles d'ODF/);
  assert.notEqual((await one(`select statut from traces_placement where id=$1`, [trace.id])).statut, "bon_pour_coupe");
});

await test("ODF rattaché ensuite : couches attribuées, le tracé se valide", async () => {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 20 } });
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',2,'',$2)`, [o.model.id, manche.id]);
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fiche.id, o.line.id]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,10)`, [trace.id, o.line.id]);
  await q(`select valider_trace($1,'marge')`, [trace.id]);
  assert.equal((await one(`select statut from traces_placement where id=$1`, [trace.id])).statut, "bon_pour_coupe");
});

console.log("Ordre de tracé sans ODF : tous les tests passent");
