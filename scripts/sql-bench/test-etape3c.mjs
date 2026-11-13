// Scénarios SQL de l'étape 3c (migration 0155) : tracé multi-semi-finis
// (corps + manches sur un même matelas), refus d'un article qui n'a pas toutes
// les pièces (D1), contrôle de cohérence avec le fichier du tracé et
// dérogation (D2), pré-remplissage depuis le DXF, clôture par semi-fini,
// besoins de coupe agrégés.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;
async function asAuth(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const admin = await mkUser("administrateur");
const commercial = await mkUser("commercial");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client 3c') returning id`)).id;
await as(admin);

const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id`);
const col = await one(`insert into product_models(name, nature) values ('Col rond','semi_fini') returning id`);
const corps = await one(`insert into product_models(name, nature) values ('Corps','semi_fini') returning id`);
// T-shirt complet : 2 manches + 1 col + 1 corps.
async function odf(n, avecCorps = true) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [o.model.id]);
  await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md'),($1,'',1,'',$3,null)`, [o.model.id, manche.id, col.id]);
  if (avecCorps) await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id) values ($1,'',1,'',$2)`, [o.model.id, corps.id]);
  return o;
}
const A = await odf(30);
const B = await odf(20);
const D = await odf(10);
const E = await odf(10, false); // pas de corps dans sa nomenclature

const ordre = async (numero) => (await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ($1,true,'ordre') returning id`, [numero]));
const trace = async (fiche, n, ref) => (await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,$2,$3) returning id`, [fiche.id, n, ref]));
const pieces = (t, rows) => Promise.all(rows.map(([sf, taille, n]) => q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,$4)`, [t.id, sf.id, taille, n])));

await test("besoins de coupe agrégés : un tableau pour toutes les ODF ouvertes, regroupé par tissu et couleur", async () => {
  const r = await q(`select * from besoins_coupe_agreges() where semi_fini_id=$1 and taille=$2`, [manche.id, M]);
  // Une couleur par ODF (fixture) : quatre lignes (A, B, D et E) ; 2 manches par t-shirt.
  assert.equal(r.length, 4);
  assert.equal(r.reduce((s, x) => s + x.demandees, 0), 140);
  // Même couleur : une seule ligne agrégée, trois articles, trois ODF.
  await q(`update production_order_lines set couleur_unique_id=(select couleur_unique_id from production_order_lines where id=$1) where id in ($2,$3)`, [A.line.id, B.line.id, D.line.id]);
  const g = await one(`select * from besoins_coupe_agreges() where semi_fini_id=$1 and taille=$2 and couleur_id=(select couleur_unique_id from production_order_lines where id=$3)`, [manche.id, M, A.line.id]);
  assert.deepEqual([g.demandees, g.reste, g.nb_lignes, g.nb_odf], [120, 120, 3, 3]);
  assert.equal(g.lignes.length, 3);
  // E n'a pas de corps : il n'apparaît pas dans les besoins de corps.
  const c = await one(`select nb_lignes from besoins_coupe_agreges() where semi_fini_id=$1 and taille=$2`, [corps.id, M]);
  assert.equal(c.nb_lignes, 3);
});

let fiche, t1, tCol;
await test("un tracé porte plusieurs semi-finis : corps + manches sur le même matelas", async () => {
  fiche = await ordre("OT-3C-1");
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2),($1,$3)`, [fiche.id, A.line.id, B.line.id]);
  t1 = await trace(fiche, 1, "OT-3C-1-T1");
  await pieces(t1, [[manche, M, 4], [corps, M, 2]]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,15),($1,$3,10)`, [t1.id, A.line.id, B.line.id]);
  // A : 15 × 4 = 60 manches et 15 × 2 = 30 corps ; B : 40 et 20 → aucun surplus.
  assert.deepEqual((await one(`select valider_trace($1) s`, [t1.id])).s, {});
  const bm = await one(`select prevues, reste from besoin_pieces_ligne($1,$2) where taille=$3`, [A.line.id, manche.id, M]);
  const bc = await one(`select prevues, reste from besoin_pieces_ligne($1,$2) where taille=$3`, [A.line.id, corps.id, M]);
  assert.deepEqual([bm.prevues, bm.reste, bc.prevues, bc.reste], [60, 0, 30, 0]);
  // Ce tracé n'a pas été contrôlé par un fichier : validé, marqué « non vérifié ».
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [t1.id])).controle_statut, "non_verifie");
});

// 0183 : fin de la règle « toutes les pièces du tracé » (D1) ; un article ne
// reçoit que les pièces de sa nomenclature, pièce par pièce.
await test("pièce par pièce : un article ne reçoit que les pièces de sa nomenclature", async () => {
  const f2 = await ordre("OT-3C-2");
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f2.id, E.line.id]);
  const t = await trace(f2, 1, "OT-3C-2-T1");
  await pieces(t, [[manche, M, 4]]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,2)`, [t.id, E.line.id]);
  // Ajouter le corps au tracé alors que E n'en a pas : permis (d'autres articles le prendront).
  await pieces(t, [[corps, M, 2]]);
  // Des corps pour E : refusés, il n'en a pas.
  await expectFail(
    () => q(`insert into trace_couches_pieces(trace_id, production_order_line_id, semi_fini_id, cle, nb_couches) values ($1,$2,$3,'x',1)`, [t.id, E.line.id, corps.id]),
    /n'a pas cette pièce dans sa nomenclature/
  );
  // Tracé saisi à l'ancienne : à la conversion, E ne reçoit que ses manches.
  await q(`select couches_vers_pieces($1)`, [t.id]);
  const recues = await q(`select semi_fini_id from trace_couches_pieces where trace_id=$1 and production_order_line_id=$2`, [t.id, E.line.id]);
  assert.deepEqual(recues.map((r) => r.semi_fini_id), [manche.id]);
});

// Bibliothèque de patrons (un patron par semi-fini, une taille) et analyses de DXF.
async function patron(sf, code, taille, expected = 1) {
  const a = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ($1,$1,$2) returning id`, [code, sf.id]);
  const p = await one(`insert into patterns(article_id, size) values ($1,$2) returning id`, [a.id, taille]);
  return one(`insert into pattern_pieces(pattern_id, name, expected_count, area, perimeter, radial_signature, points) values ($1,$2,$3,100,40,'[]'::jsonb,'[]'::jsonb) returning id`, [p.id, code, expected]);
}
const pcManche = await patron(manche, "MAN", M);
const pcCorps = await patron(corps, "COR", M);
const analyse = (t, reconnus, nonReconnues = []) =>
  q(`insert into analyses_trace(trace_id, nb_pieces_detectees, patrons_reconnus, pieces_non_reconnues, taux_reconnaissance, reconnaissance_complete)
     values ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
     on conflict (trace_id) do update set patrons_reconnus=excluded.patrons_reconnus, pieces_non_reconnues=excluded.pieces_non_reconnues`,
    [t.id, reconnus.reduce((s, r) => s + r.quantite, 0), JSON.stringify(reconnus.map((r) => ({ patron_id: r.id, article: "x", taille: M, piece: "x", quantite: r.quantite, dont_en_miroir: 0 }))),
     JSON.stringify(nonReconnues), nonReconnues.length ? 0.8 : 1, nonReconnues.length === 0]);

let fd, td;
await test("D2 : le DXF pré-remplit les pièces ; la saisie manuelle reste possible ; contrôle conforme", async () => {
  fd = await ordre("OT-3C-4");
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [fd.id, D.line.id]);
  td = await trace(fd, 1, "OT-3C-4-T1");
  await expectFail(() => q(`select pre_remplir_pieces_trace($1)`, [td.id]), /aucun fichier de tracé analysé/);
  await analyse(td, [{ id: pcManche.id, quantite: 4 }, { id: pcCorps.id, quantite: 2 }]);
  assert.equal((await one(`select pre_remplir_pieces_trace($1) n`, [td.id])).n, 2);
  const r = await q(`select semi_fini_id, quantite_par_couche, source from trace_semi_finis where trace_id=$1 order by quantite_par_couche`, [td.id]);
  assert.deepEqual(r.map((x) => [x.quantite_par_couche, x.source]), [[2, "dxf"], [4, "dxf"]]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [td.id])).controle_statut, "conforme");
  // Saisie manuelle toujours possible : on la modifie, elle diffère du fichier → écart.
  await q(`update trace_semi_finis set quantite_par_couche=6, source='saisie' where trace_id=$1 and semi_fini_id=$2`, [td.id, manche.id]);
  const c = await one(`select controle_statut, controle_detail from traces_placement where id=$1`, [td.id]);
  assert.equal(c.controle_statut, "ecart");
  assert.deepEqual([c.controle_detail.ecarts[0].declare, c.controle_detail.ecarts[0].reconnu], [6, 4]);
});

await test("un tracé en écart ne se valide pas ; dérogation d'un responsable avec motif, valable pour cet écart seulement", async () => {
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,5)`, [td.id, D.line.id]);
  await expectFail(() => q(`select valider_trace($1)`, [td.id]), /ne correspond pas aux pièces déclarées/);
  await expectFail(() => q(`select deroger_controle_trace($1,'  ')`, [td.id]), /motif est obligatoire/);
  await as(commercial);
  await expectFail(() => q(`select deroger_controle_trace($1,'ok')`, [td.id]), /accès refusé/);
  await as(admin);
  await q(`select deroger_controle_trace($1,'Pièces du fichier à refaire, le chef de coupe a vérifié')`, [td.id]);
  assert.equal((await one(`select controle_derogation_motif m from traces_placement where id=$1`, [td.id])).m, "Pièces du fichier à refaire, le chef de coupe a vérifié");
  // L'écart a changé (le fichier est ré-analysé autrement) : la dérogation tombe.
  await analyse(td, [{ id: pcManche.id, quantite: 8 }, { id: pcCorps.id, quantite: 2 }]);
  assert.equal((await one(`select controle_derogation_motif m from traces_placement where id=$1`, [td.id])).m, null);
  await expectFail(() => q(`select valider_trace($1)`, [td.id]), /ne correspond pas/);
  // Retour à la conformité : le fichier redonne les mêmes pièces que la saisie.
  await analyse(td, [{ id: pcManche.id, quantite: 6 }, { id: pcCorps.id, quantite: 2 }]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [td.id])).controle_statut, "conforme");
});

await test("pièce non reconnue dans le fichier : écart de contrôle", async () => {
  await analyse(td, [{ id: pcManche.id, quantite: 6 }, { id: pcCorps.id, quantite: 2 }], [{ index_piece: 3, calque: "x", meilleur_score: 0.4, meilleur_candidat: null }]);
  const c = await one(`select controle_statut, controle_detail from traces_placement where id=$1`, [td.id]);
  assert.equal(c.controle_statut, "ecart");
  assert.equal(c.controle_detail.pieces_non_reconnues, 1);
  await analyse(td, [{ id: pcManche.id, quantite: 6 }, { id: pcCorps.id, quantite: 2 }]);
});

await test("tracé validé qui repasse en écart : signalé par une anomalie sur l'ODF, sans être annulé ; résolue au retour", async () => {
  // D : manches 6 × 5 couches = 30 > 20 demandées → surplus : motif exigé.
  await expectFail(() => q(`select valider_trace($1)`, [td.id]), /surplus .* motif est obligatoire/);
  await q(`select valider_trace($1,'marge de coupe acceptée')`, [td.id]);
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [td.id])).controle_statut, "conforme");
  await analyse(td, [{ id: pcManche.id, quantite: 5 }, { id: pcCorps.id, quantite: 2 }]);
  const a = await q(`select message from production_order_anomalies where cle_auto=$1 and resolved_at is null`, ["controle_trace:" + td.id]);
  assert.equal(a.length, 1);
  assert.equal((await one(`select statut from traces_placement where id=$1`, [td.id])).statut, "bon_pour_coupe");
  await analyse(td, [{ id: pcManche.id, quantite: 6 }, { id: pcCorps.id, quantite: 2 }]);
  assert.equal((await q(`select 1 from production_order_anomalies where cle_auto=$1 and resolved_at is null`, ["controle_trace:" + td.id])).length, 0);
});

await test("clôture par semi-fini : pièces obtenues par semi-fini et taille, jamais au-dessus du prévu, manque justifié", async () => {
  for (const o of [A, B]) {
    await q(`select submit_production_order($1)`, [o.po.id]);
    await q(`select validate_production_order($1)`, [o.po.id]);
  }
  const lignes = (obtA, obtB) => JSON.stringify([
    { line_id: A.line.id, couches_reelles: 15, obtenus: obtA },
    { line_id: B.line.id, couches_reelles: 10, obtenus: obtB },
  ]);
  const cl = (l, j = null) => one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,12.5,0.8,$3) r`, [t1.id, l, j]);
  await expectFail(() => cl(lignes({ [manche.id]: { [M]: 61 }, [corps.id]: { [M]: 30 } }, { [manche.id]: { [M]: 40 }, [corps.id]: { [M]: 20 } })), /au plus 60/);
  await expectFail(() => cl(lignes({ [manche.id]: { [M]: 60 }, [corps.id]: { [M]: 29 } }, { [manche.id]: { [M]: 40 }, [corps.id]: { [M]: 20 } })), /justification obligatoire/);
  await cl(lignes({ [manche.id]: { [M]: 60 }, [corps.id]: { [M]: 29 } }, { [manche.id]: { [M]: 40 }, [corps.id]: { [M]: 20 } }), "1 corps déchiré");
  assert.equal((await one(`select statut from traces_placement where id=$1`, [t1.id])).statut, "termine");
  const p = await q(`select pm.name n, sum(pc.quantite)::int q from pieces_coupees pc join product_models pm on pm.id=pc.semi_fini_id where pc.trace_id=$1 group by pm.name order by pm.name`, [t1.id]);
  assert.deepEqual(p.map((r) => [r.n, r.q]), [["Corps", 49], ["Manche courte", 100]]);
  // Cols : un second matelas ; l'assemblage prend le minimum sur manches ÷ 2, cols, corps.
  tCol = await trace(fiche, 2, "OT-3C-1-T2");
  await pieces(tCol, [[col, M, 2]]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,15),($1,$3,10)`, [tCol.id, A.line.id, B.line.id]);
  await q(`select valider_trace($1)`, [tCol.id]);
  const r = (await one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,12.5,0.8,null) r`, [tCol.id, JSON.stringify([
    { line_id: A.line.id, couches_reelles: 15, obtenus: { [col.id]: { [M]: 30 } } },
    { line_id: B.line.id, couches_reelles: 10, obtenus: { [col.id]: { [M]: 20 } } },
  ])])).r;
  // A : min(60/2, 30, 29 corps…) = 29 corps sur A ; B : 40/2 = 20, 20 corps, 20 cols → 20.
  assert.deepEqual([r.kits_assembles[A.line.id], r.kits_assembles[B.line.id]], [29, 20]);
});

await test("reprise d'un ancien patron de produit fini : pièce par pièce vers des semi-finis, ancien patron conservé mais exclu", async () => {
  const modele = await one(`insert into product_models(name) values ('T-shirt ancien patron') returning id`);
  // Un ancien patron de produit fini date d'avant 0143 (qui l'interdit désormais) : on le recrée en suspendant ce garde-fou.
  await db.exec(`alter table pattern_articles disable trigger pattern_articles_semi_fini`);
  const anc = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ('TS-OLD','Ancien patron', $1) returning id`, [modele.id]);
  await db.exec(`alter table pattern_articles enable trigger pattern_articles_semi_fini`);
  for (const taille of [M, "Homme/L"]) {
    const pat = await one(`insert into patterns(article_id, size) values ($1,$2) returning id`, [anc.id, taille]);
    for (const nom of ["manche", "col"]) {
      await q(`insert into pattern_pieces(pattern_id, name, expected_count, area, perimeter, radial_signature, points) values ($1,$2,1,50,30,'[1]'::jsonb,'[]'::jsonb)`, [pat.id, nom]);
    }
  }
  const mancheNeuve = await one(`insert into product_models(name, nature) values ('Manche à migrer','semi_fini') returning id`);
  const colNeuf = await one(`insert into product_models(name, nature) values ('Col à migrer','semi_fini') returning id`);
  await expectFail(() => q(`select migrer_ancien_patron($1,$2::jsonb)`, [anc.id, JSON.stringify([{ piece: "manche", semi_fini_id: mancheNeuve.id }])]), /pièce « col » n'est pas affectée/);
  await expectFail(() => q(`select migrer_ancien_patron($1,$2::jsonb)`, [anc.id, JSON.stringify([{ piece: "manche", semi_fini_id: modele.id }, { piece: "col", semi_fini_id: null }])]), /seul un semi-fini/);
  await as(commercial);
  await expectFail(() => q(`select migrer_ancien_patron($1,$2::jsonb)`, [anc.id, JSON.stringify([{ piece: "manche", semi_fini_id: mancheNeuve.id }, { piece: "col", semi_fini_id: colNeuf.id }])]), /accès refusé/);
  await as(admin);
  const r = (await one(`select migrer_ancien_patron($1,$2::jsonb) r`, [anc.id, JSON.stringify([{ piece: "manche", semi_fini_id: mancheNeuve.id }, { piece: "col", semi_fini_id: colNeuf.id }])])).r;
  assert.equal(r.length, 2);
  // Un patron par semi-fini, avec ses deux tailles et ses pièces copiées.
  const n = await one(`select count(distinct p.id)::int tailles, count(pp.id)::int pieces from pattern_articles pa join patterns p on p.article_id=pa.id join pattern_pieces pp on pp.pattern_id=p.id where pa.product_model_id=$1`, [mancheNeuve.id]);
  assert.deepEqual([n.tailles, n.pieces], [2, 2]);
  assert.ok((await one(`select migre_le from pattern_articles where id=$1`, [anc.id])).migre_le);
  await expectFail(() => q(`select migrer_ancien_patron($1,$2::jsonb)`, [anc.id, JSON.stringify([{ piece: "manche", semi_fini_id: mancheNeuve.id }, { piece: "col", semi_fini_id: null }])]), /déjà été repris/);
});

await test("droits : pièces du tracé figées une fois validé ; lecture par le personnel ; fonctions internes fermées", async () => {
  assert.equal((await asAuth(admin, `update trace_semi_finis set quantite_par_couche=9 where trace_id=$1 returning id`, [t1.id])).length, 0);
  assert.ok((await asAuth(admin, `select id from trace_semi_finis where trace_id=$1`, [t1.id])).length >= 2);
  await expectFail(() => asAuth(commercial, `select * from besoins_coupe_agreges()`), /./).catch(() => {});
  const r = await asAuth(commercial, `select * from besoins_coupe_agreges()`);
  assert.equal(r.length, 0); // le droit Patronnage « voir » est exigé
  await expectFail(() => asAuth(admin, `select controle_coherence_trace($1)`, [t1.id]), /permission denied/);
});

console.log("Étape 3c : tous les tests passent");
