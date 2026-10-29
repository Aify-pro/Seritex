// Scénarios SQL de l'étape 4b (migration 0153) : paquets QR par pièce à la
// clôture d'un matelas regroupé, pièces comptées par paquets, réorientation
// d'un paquet vers une autre ligne d'ODF (même pièce, couleur, tissu ; avant
// verrou ; pièces pas encore assemblées ; motif), sous-lots, regroupement.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client 4b') returning id`)).id;
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id`);
const col = await one(`insert into product_models(name, nature) values ('Col rond','semi_fini') returning id`);
const rouge = await one(`insert into colors(name, code) values ('Rouge 4b','R4B') returning id`);
async function odf(n, couleur = null) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [o.model.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md'),($1,'',1,'',$3,null)`, [o.model.id, manche.id, col.id]);
  if (couleur) await q(`update production_order_lines set couleur_unique_id=$2 where id=$1`, [o.line.id, couleur]);
  return o;
}
const A = await odf(30);
const B = await odf(20);
await q(`update production_order_lines set couleur_unique_id=(select couleur_unique_id from production_order_lines where id=$1) where id=$2`, [A.line.id, B.line.id]);
const C = await odf(10, rouge.id); // autre couleur : incompatible

async function ordre(sf, numero, rep, couches) {
  const f = await one(`insert into fiches_placement(numero_ot, semi_fini_id, designation_article) values ($1,$2,$3) returning id`, [numero, sf.id, sf === manche ? "Manche courte" : "Col rond"]);
  const lignes = Object.keys(couches);
  for (const l of lignes) await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, l]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,1,$2,$3::jsonb) returning id`, [f.id, numero + "-T1", JSON.stringify(rep)]);
  for (const [l, n] of Object.entries(couches)) await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,$3)`, [t.id, l, n]);
  await q(`select valider_trace($1,'marge')`, [t.id]);
  return t;
}
// A : 16 couches × 4 = 64 manches (4 de marge) ; B : 10 × 4 = 40 ; C : 5 × 4 = 20.
const tManche = await ordre(manche, "OT-M4B", { [M]: 4 }, { [A.line.id]: 16, [B.line.id]: 10, [C.line.id]: 5 });
const tCol = await ordre(col, "OT-C4B", { [M]: 2 }, { [A.line.id]: 15, [B.line.id]: 10, [C.line.id]: 5 });
for (const o of [A, B, C]) {
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
}
const cloturer = (t, lignes, justif = null) =>
  one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,15,1,$3) r`, [t.id, JSON.stringify(lignes), justif]);
const kits = async (line) =>
  (await one(`select coalesce(sum(e.quantity),0)::int n from work_order_events e join work_orders w on w.id=e.work_order_id
              where w.production_order_line_id=$1 and e.event_type='matelas_cloture' and e.trace_id is null`, [line])).n;
const paquet = (line, sf) => one(`select * from article_lots where production_order_line_id=$1 and semi_fini_id=$2 and statut='en_cours' order by created_at limit 1`, [line, sf.id]);

await test("clôture regroupée : un paquet QR par article × taille pour la pièce coupée", async () => {
  await cloturer(tManche, [
    { line_id: A.line.id, couches_reelles: 16, obtenus: { [M]: 64 } },
    { line_id: B.line.id, couches_reelles: 10, obtenus: { [M]: 38 } },
    { line_id: C.line.id, couches_reelles: 5, obtenus: { [M]: 20 } },
  ], "2 manches abîmées pour B");
  await cloturer(tCol, [
    { line_id: A.line.id, couches_reelles: 15, obtenus: { [M]: 30 } },
    { line_id: B.line.id, couches_reelles: 10, obtenus: { [M]: 20 } },
    { line_id: C.line.id, couches_reelles: 5, obtenus: { [M]: 10 } },
  ]);
  const pa = await paquet(A.line.id, manche);
  assert.deepEqual([pa.categorie, pa.composition_taille], ["semi_fini", { [M]: 64 }]);
  assert.ok(pa.cloture_pieces_id);
  assert.deepEqual([await kits(A.line.id), await kits(B.line.id)], [30, 19]);
});

await test("réorientation : motif, couleur, verrou et pièces non assemblées contrôlés", async () => {
  const pa = await paquet(A.line.id, manche);
  const compat = (await q(`select line_id from lignes_compatibles_paquet($1)`, [pa.code])).map((r) => r.line_id);
  assert.ok(compat.includes(B.line.id));
  assert.ok(!compat.includes(C.line.id)); // autre couleur
  await expectFail(() => q(`select reorienter_paquet($1,$2,$3::jsonb,'')`, [pa.code, B.line.id, JSON.stringify({ [M]: 2 })]), /motif est obligatoire/);
  await expectFail(() => q(`select reorienter_paquet($1,$2,$3::jsonb,'besoin B')`, [pa.code, C.line.id, JSON.stringify({ [M]: 2 })]), /même couleur/);
  await expectFail(() => q(`select reorienter_paquet($1,$2,$3::jsonb,'besoin B')`, [pa.code, B.line.id, JSON.stringify({ [M]: 5 })]), /seulement 4 pièce/);
  const pc = await paquet(C.line.id, manche);
  await q(`update article_lots set verrouille_le=now() where id=$1`, [pc.id]);
  await expectFail(() => q(`select reorienter_paquet($1,$2,null,'x')`, [pc.code, A.line.id]), /verrouillé/);
});

await test("réorientation partielle : sous-lot de 2 manches vers B, qui assemble son 20e t-shirt", async () => {
  const pa = await paquet(A.line.id, manche);
  const r = (await one(`select reorienter_paquet($1,$2,$3::jsonb,'2 manches abîmées sur B') r`, [pa.code, B.line.id, JSON.stringify({ [M]: 2 })])).r;
  const enfant = await one(`select production_order_line_id, production_order_id, semi_fini_id, composition_taille, parent_lot_id from article_lots where code=$1`, [r.code]);
  assert.deepEqual([enfant.production_order_line_id, enfant.production_order_id, enfant.semi_fini_id, enfant.parent_lot_id], [B.line.id, B.po.id, manche.id, pa.id]);
  assert.deepEqual((await one(`select composition_taille from article_lots where id=$1`, [pa.id])).composition_taille, { [M]: 62 });
  assert.equal(await kits(B.line.id), 20);
  const ev = await one(`select detail from article_lot_events where article_lot_id=(select id from article_lots where code=$1) and type='reorientation'`, [r.code]);
  assert.equal(ev.detail.motif, "2 manches abîmées sur B");
  const st = Object.fromEntries((await q(`select line_id, coupees, assemblees, en_attente from stock_tampon_semi_fini($1)`, [manche.id])).map((x) => [x.line_id, [x.coupees, x.assemblees, x.en_attente]]));
  assert.deepEqual(st[A.line.id], [62, 60, 2]);
  assert.deepEqual(st[B.line.id], [40, 40, 0]);
});

await test("regroupement : pas de mélange de pièces ; paquets d'un semi-fini listés avec leur détenteur", async () => {
  const pm = await paquet(A.line.id, manche);
  const pcol = await paquet(A.line.id, col);
  await expectFail(() => q(`select * from merge_article_lots(array[$1,$2])`, [pm.code, pcol.code]), /même pièce/);
  const liste = await q(`select code, detenteur from paquets_semi_fini($1)`, [manche.id]);
  assert.ok(liste.length >= 3 && liste.every((l) => l.detenteur === "Coupe"));
});

console.log("Étape 4b : tous les tests passent");
