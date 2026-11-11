// Scénarios SQL de la migration 0180 : sur un tracé tubulaire, une pièce de
// patron à plat donne 2 pièces par contour, une pièce au pli (demi-pièce) 1 ;
// un tracé dont le fichier porte une pièce au pli devient tubulaire et ne
// peut pas être ouvert ; tissus prévus par tracé.
// Cas réel (OT-2026-0009-T1) : le patron de la manche S contient la manche
// entière et la demi-manche ; le fichier en porte 3 entières et 4 demies.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const S = "Homme/S";
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche TU','semi_fini') returning id`);
const corps = await one(`insert into product_models(name, nature) values ('Corps avant TU','semi_fini') returning id`);
async function patron(sf, code, pieces) {
  const a = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ($1,$1,$2) returning id`, [code, sf.id]);
  const p = await one(`insert into patterns(article_id, size) values ($1,$2) returning id`, [a.id, S]);
  const ids = [];
  for (const [nom, attendu] of pieces) {
    // Comme l'application à l'enregistrement : une « demi-… » est posée au pli.
    const pose = /^demi/i.test(nom) ? "au_pli" : "a_plat";
    ids.push((await one(`insert into pattern_pieces(pattern_id, name, expected_count, pose_tubulaire, area, perimeter, radial_signature, points) values ($1,$2,$3,$4,100,40,'[]'::jsonb,'[]'::jsonb) returning id`, [p.id, nom, attendu, pose])).id);
  }
  return ids;
}
const [pcManche, pcDemiManche] = await patron(manche, "MTU", [["Manche S", 1], ["Demi-manche S", 1]]);
const [pcCorps] = await patron(corps, "CTU", [["Corps avant S", 1]]);
const fiche = await one(`insert into fiches_placement(regroupee, designation_article) values (true,'Tubulaire') returning id`);
const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'TU-T1') returning id`, [fiche.id]);
const analyse = (trace, lignes) =>
  q(
    `insert into analyses_trace(trace_id, nb_pieces_detectees, patrons_reconnus, pieces_non_reconnues, taux_reconnaissance, reconnaissance_complete)
     values ($1, $2, $3::jsonb, '[]'::jsonb, 1, true)
     on conflict (trace_id) do update set patrons_reconnus = excluded.patrons_reconnus`,
    [trace.id, lignes.reduce((s, [, n]) => s + n, 0), JSON.stringify(lignes.map(([id, n]) => ({ patron_id: id, article: "x", taille: S, piece: "x", quantite: n, dont_en_miroir: 0 })))]
  );
const reconnus = async (trace) =>
  Object.fromEntries((await q(`select semi_fini_id, quantite, divisible from trace_pieces_reconnues($1)`, [trace.id])).map((r) => [r.semi_fini_id, [r.quantite, r.divisible]]));
const forme = async (trace) => (await one(`select forme from traces_placement where id=$1`, [trace.id])).forme;

await test("ouvert, sans pièce au pli : 1 contour = 1 pièce (règle inchangée)", async () => {
  await analyse(t, [[pcManche, 3], [pcCorps, 5]]);
  assert.equal(await forme(t), "ouvert");
  const r = await reconnus(t);
  assert.deepEqual([r[manche.id], r[corps.id]], [[3, true], [5, true]]);
});

await test("demi-manche dans le fichier : pièce au pli, le tracé passe en tubulaire", async () => {
  assert.equal((await one(`select pose_tubulaire from pattern_pieces where id=$1`, [pcDemiManche])).pose_tubulaire, "au_pli");
  await analyse(t, [[pcManche, 3], [pcDemiManche, 4], [pcCorps, 5]]);
  assert.equal(await forme(t), "tubulaire");
});

await test("tubulaire : manche à plat × 2 + demi-manche au pli × 1 (3 × 2 + 4 = 10 manches), corps à plat × 2", async () => {
  const r = await reconnus(t);
  assert.deepEqual([r[manche.id], r[corps.id]], [[10, true], [10, true]]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,10),($1,$4,$3,10)`, [t.id, manche.id, S, corps.id]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [t.id])).controle_statut, "conforme");
});

await test("corps marqué au pli : 5 contours = 5 corps ; le contrôle se refait seul", async () => {
  await q(`update pattern_pieces set pose_tubulaire='au_pli' where id=$1`, [pcCorps]);
  assert.deepEqual((await reconnus(t))[corps.id], [5, true]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [t.id])).controle_statut, "ecart");
  await q(`update trace_semi_finis set quantite_par_couche=5 where trace_id=$1 and semi_fini_id=$2`, [t.id, corps.id]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [t.id])).controle_statut, "conforme");
});

await test("pièce au pli dans le fichier : le tracé ne peut pas repasser en ouvert", async () => {
  await expectFail(() => q(`update traces_placement set forme='ouvert' where id=$1`, [t.id]), /pièces posées au pli du tubulaire/);
});

await test("une pièce qui devient « au pli » fait passer ses tracés en préparation en tubulaire", async () => {
  const t2 = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,2,'TU-T2') returning id`, [fiche.id]);
  const col = await one(`insert into product_models(name, nature) values ('Col TU','semi_fini') returning id`);
  const [pcAutre] = await patron(col, "COLTU", [["Col S", 1]]);
  await analyse(t2, [[pcAutre, 2]]);
  assert.equal(await forme(t2), "ouvert");
  await q(`update pattern_pieces set pose_tubulaire='au_pli' where id=$1`, [pcAutre]);
  assert.equal(await forme(t2), "tubulaire");
});

await test("tissus prévus : déclinaison tissu × couleur seulement", async () => {
  const mp = await one(`insert into product_models(name, nature) values ('Jersey TU','mp') returning id`);
  const tex = await one(`insert into textiles(nom, grammage, product_model_id) values ('Jersey TU 180', 180, $1) returning id`, [mp.id]);
  const bleu = await one(`insert into colors(name, code) values ('TUBleu','TUB') returning id`);
  const v = await one(`insert into product_variants(model_id, textile_id, color_id, code) values ($1,$2,$3,'JETU180TUB') returning id`, [mp.id, tex.id, bleu.id]);
  await q(`select trace_ajouter_tissu($1,$2)`, [t.id, v.id]);
  assert.equal((await one(`select count(*)::int n from trace_tissus where trace_id=$1`, [t.id])).n, 1);
  await q(`select trace_retirer_tissu($1,$2)`, [t.id, v.id]);
  assert.equal((await one(`select count(*)::int n from trace_tissus where trace_id=$1`, [t.id])).n, 0);
});

console.log("Tracé tubulaire : tous les tests passent");
