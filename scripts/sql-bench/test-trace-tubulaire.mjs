// Scénarios SQL de la migration 0180 : le semi-fini dit où il se coupe
// (ouvert, tubulaire, les deux) et combien de pièces donne un contour sur
// chaque forme ; le décompte du tracé et sa forme en découlent ; tissus
// prévus par tracé.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const S = "Homme/S";
await as(admin);

async function semiFini(nom, reglage = {}) {
  const sf = await one(`insert into product_models(name, nature) values ($1,'semi_fini') returning id`, [nom]);
  const r = { coupe_ouvert: true, coupe_tubulaire: true, pieces_contour_ouvert: 1, pieces_contour_tubulaire: 2, ...reglage };
  await q(
    `update product_models set coupe_ouvert=$2, coupe_tubulaire=$3, pieces_contour_ouvert=$4, pieces_contour_tubulaire=$5 where id=$1`,
    [sf.id, r.coupe_ouvert, r.coupe_tubulaire, r.pieces_contour_ouvert, r.pieces_contour_tubulaire]
  );
  const a = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ($1,$1,$2) returning id`, [nom.slice(0, 8), sf.id]);
  const p = await one(`insert into patterns(article_id, size) values ($1,$2) returning id`, [a.id, S]);
  sf.piece = (await one(`insert into pattern_pieces(pattern_id, name, expected_count, area, perimeter, radial_signature, points) values ($1,$2,1,100,40,'[]'::jsonb,'[]'::jsonb) returning id`, [p.id, nom])).id;
  return sf;
}
// Corps avant : les deux formes (1 sur ouvert, 2 sur tubulaire).
// Demi-manche : tubulaire seulement, posée au pli (1 pièce par contour).
// Manche ouverte : ouvert seulement.
const corps = await semiFini("Corps avant");
const demiManche = await semiFini("Demi-manche", { coupe_ouvert: false, pieces_contour_tubulaire: 1 });
const mancheOuverte = await semiFini("Manche ouverte", { coupe_tubulaire: false });
const fiche = await one(`insert into fiches_placement(regroupee, designation_article) values (true,'Formes') returning id`);
let n = 0;
async function trace(lignes) {
  n += 1;
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,$2,$3) returning id`, [fiche.id, n, `FO-T${n}`]);
  await q(
    `insert into analyses_trace(trace_id, nb_pieces_detectees, patrons_reconnus, pieces_non_reconnues, taux_reconnaissance, reconnaissance_complete)
     values ($1, 1, $2::jsonb, '[]'::jsonb, 1, true)`,
    [t.id, JSON.stringify(lignes.map(([sf, qte]) => ({ patron_id: sf.piece, article: "x", taille: S, piece: "x", quantite: qte, dont_en_miroir: 0 })))]
  );
  return t;
}
const reconnus = async (t) => Object.fromEntries((await q(`select semi_fini_id, quantite from trace_pieces_reconnues($1)`, [t.id])).map((r) => [r.semi_fini_id, r.quantite]));
const forme = async (t) => (await one(`select forme from traces_placement where id=$1`, [t.id])).forme;

await test("corps avant (les deux) : 1 pièce par contour sur ouvert, 2 sur tubulaire — même patron", async () => {
  const t = await trace([[corps, 5]]);
  assert.equal(await forme(t), "ouvert");
  assert.equal((await reconnus(t))[corps.id], 5);
  await q(`update traces_placement set forme='tubulaire' where id=$1`, [t.id]);
  assert.equal((await reconnus(t))[corps.id], 10);
});

await test("demi-manche (tubulaire seulement) : le tracé passe en tubulaire, 1 pièce par contour", async () => {
  const t = await trace([[demiManche, 4], [corps, 3]]);
  assert.equal(await forme(t), "tubulaire");
  const r = await reconnus(t);
  assert.deepEqual([r[demiManche.id], r[corps.id]], [4, 6]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,4),($1,$4,$3,6)`, [t.id, demiManche.id, S, corps.id]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [t.id])).controle_statut, "conforme");
  await expectFail(() => q(`update traces_placement set forme='ouvert' where id=$1`, [t.id]), /ne se coupent pas sur ce tissu.*Demi-manche/);
});

await test("manche ouverte (ouvert seulement) : refusée sur un tracé tubulaire", async () => {
  const t = await trace([[mancheOuverte, 2]]);
  assert.equal(await forme(t), "ouvert");
  await expectFail(() => q(`update traces_placement set forme='tubulaire' where id=$1`, [t.id]), /Manche ouverte/);
});

await test("le réglage du semi-fini change : ses tracés en préparation suivent", async () => {
  const t = await trace([[corps, 2]]);
  assert.equal(await forme(t), "ouvert");
  await q(`update product_models set coupe_ouvert=false where id=$1`, [corps.id]);
  assert.equal(await forme(t), "tubulaire");
  await q(`update product_models set coupe_ouvert=true where id=$1`, [corps.id]);
  await expectFail(() => q(`update product_models set coupe_ouvert=false, coupe_tubulaire=false where id=$1`, [corps.id]), /product_models_coupe_forme/);
});

await test("tissus prévus : déclinaison tissu × couleur seulement", async () => {
  const t = await trace([[corps, 1]]);
  const mp = await one(`insert into product_models(name, nature) values ('Jersey TU','mp') returning id`);
  const tex = await one(`insert into textiles(nom, grammage, product_model_id) values ('Jersey TU 180', 180, $1) returning id`, [mp.id]);
  const bleu = await one(`insert into colors(name, code) values ('TUBleu','TUB') returning id`);
  const v = await one(`insert into product_variants(model_id, textile_id, color_id, code) values ($1,$2,$3,'JETU180TUB') returning id`, [mp.id, tex.id, bleu.id]);
  await q(`select trace_ajouter_tissu($1,$2)`, [t.id, v.id]);
  assert.equal((await one(`select count(*)::int n from trace_tissus where trace_id=$1`, [t.id])).n, 1);
  await q(`select trace_retirer_tissu($1,$2)`, [t.id, v.id]);
  assert.equal((await one(`select count(*)::int n from trace_tissus where trace_id=$1`, [t.id])).n, 0);
});

console.log("Tracé tubulaire / ouvert : tous les tests passent");
