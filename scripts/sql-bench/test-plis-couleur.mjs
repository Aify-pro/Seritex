// Scénarios SQL de la migration 0183 : plis par couleur sur un tracé
// regroupé, couches attribuées par article ET par pièce (une couche blanche
// donne les corps blancs des uns et les manches blanches des autres),
// validation, besoin prévu et clôture du matelas par couleur.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client plis') returning id`)).id;
await as(admin);

const blanc = await one(`insert into colors(name, code) values ('PCBlanc','PCB') returning id`);
const bleu = await one(`insert into colors(name, code) values ('PCBleu','PCU') returning id`);
const corps = await one(`insert into product_models(name, nature) values ('Corps PC','semi_fini') returning id`);
const manche = await one(`insert into product_models(name, nature) values ('Manche PC','semi_fini') returning id`);

// A : corps blanc, manches bleues ; B : corps bleu, manches blanches. 10 t-shirts M chacun.
async function article(couleurCorps, couleurManche) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 10 } });
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, couleur_imposee_id) values ($1,'',1,'',$2,$3),($1,'',2,'',$4,$5)`,
    [o.model.id, corps.id, couleurCorps.id, manche.id, couleurManche.id]);
  return o;
}
const A = await article(blanc, bleu);
const B = await article(bleu, blanc);

const fiche = await one(`insert into fiches_placement(regroupee, designation_article) values (true,'Bicolores') returning id`);
for (const o of [A, B]) await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fiche.id, o.line.id]);
const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'PC-T1') returning id`, [fiche.id]);
// Par couche : 1 corps M et 2 manches M.
await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,1),($1,$4,$3,2)`, [t.id, corps.id, M, manche.id]);
const cle = async (o, sf) => (await one(`select cle_couche_ligne($1,$2) c`, [o.line.id, sf.id])).c;

await test("clé de couche : la couleur de la pièce chez l'article (corps blanc de A = manches blanches de B)", async () => {
  assert.equal(await cle(A, corps), await cle(B, manche));
  assert.equal(await cle(A, manche), await cle(B, corps));
  assert.notEqual(await cle(A, corps), await cle(A, manche));
});

await test("plis par couleur : chaque pièce d'une couleur va à l'article qui l'a dans cette couleur", async () => {
  const cBlanc = await cle(A, corps);
  const cBleu = await cle(A, manche);
  await q(`insert into trace_plis_couleur(trace_id, cle, nb_plis) values ($1,$2,10),($1,$3,10)`, [t.id, cBlanc, cBleu]);
  // Couche blanche : corps → A, manches → B ; couche bleue : corps → B, manches → A.
  await q(
    `insert into trace_couches_pieces(trace_id, production_order_line_id, semi_fini_id, cle, nb_couches)
     values ($1,$2,$3,$4,10),($1,$5,$6,$4,10),($1,$5,$3,$7,10),($1,$2,$6,$7,10)`,
    [t.id, A.line.id, corps.id, cBlanc, B.line.id, manche.id, cBleu]
  );
  assert.equal((await one(`select nb_plis from traces_placement where id=$1`, [t.id])).nb_plis, 20);
  const r = await q(`select production_order_line_id, nb_couches from trace_couches where trace_id=$1`, [t.id]);
  assert.deepEqual(r.map((x) => x.nb_couches).sort(), [10, 10]);
  // Une pièce dans une couleur que l'article n'a pas : refusée.
  await expectFail(
    () => q(`insert into trace_couches_pieces(trace_id, production_order_line_id, semi_fini_id, cle, nb_couches) values ($1,$2,$3,$4,1)`, [t.id, A.line.id, corps.id, cBleu]),
    /ne correspond pas à la couche/
  );
});

await test("validation puis besoin prévu : pièces par article et par pièce", async () => {
  await q(`select valider_trace($1,'marge')`, [t.id]);
  const b = await one(`select prevues from besoin_pieces_ligne($1,$2) where taille=$3`, [A.line.id, corps.id, M]);
  assert.equal(b.prevues, 10);
  const m = await one(`select prevues from besoin_pieces_ligne($1,$2) where taille=$3`, [A.line.id, manche.id, M]);
  assert.equal(m.prevues, 20);
});

await test("clôture par couleur : pièces obtenues par article × pièce, t-shirts assemblés", async () => {
  for (const o of [A, B]) {
    await q(`select submit_production_order($1)`, [o.po.id]);
    await q(`select validate_production_order($1)`, [o.po.id]);
  }
  const cBlanc = await cle(A, corps);
  const cBleu = await cle(A, manche);
  const obtenus = [
    { line_id: A.line.id, semi_fini_id: corps.id, taille: M, obtenus: 10 },
    { line_id: A.line.id, semi_fini_id: manche.id, taille: M, obtenus: 20 },
    { line_id: B.line.id, semi_fini_id: corps.id, taille: M, obtenus: 10 },
    { line_id: B.line.id, semi_fini_id: manche.id, taille: M, obtenus: 20 },
  ];
  await expectFail(
    () => q(`select cloturer_matelas_couleurs($1,$2::jsonb,$3::jsonb,600,180,15,1,null)`, [t.id, JSON.stringify({ [cBlanc]: 11, [cBleu]: 10 }), JSON.stringify(obtenus)]),
    /jamais au-dessus du tracé/
  );
  await q(`select cloturer_matelas_couleurs($1,$2::jsonb,$3::jsonb,600,180,15,1,null)`, [t.id, JSON.stringify({ [cBlanc]: 10, [cBleu]: 10 }), JSON.stringify(obtenus)]);
  assert.equal((await one(`select statut from traces_placement where id=$1`, [t.id])).statut, "termine");
  assert.equal((await one(`select count(*)::int n from pieces_coupees where trace_id=$1 and quantite > 0`, [t.id])).n, 4);
  const kits = await one(
    `select coalesce(sum(e.quantity),0)::int n from work_order_events e join work_orders w on w.id=e.work_order_id
     where w.production_order_line_id=$1 and e.event_type='matelas_cloture' and e.trace_id is null`, [A.line.id]);
  assert.equal(kits.n, 10);
});

console.log("Plis par couleur, pièce par pièce : tous les tests passent");
