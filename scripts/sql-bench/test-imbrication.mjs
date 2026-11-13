// Scénarios SQL du module d'imbrication (migration 0182) : contraintes de
// coupe sur les pièces de patron, création d'un calcul par le personnel
// autorisé (jamais avec un résultat), garde-fou « terminé = tracé validé »,
// annulation, réservation des calculs par le serveur et reprise après panne.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;

async function asRole(role, uid, sql, params) {
  await as(uid);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

const roles = (await q(`select key from roles order by key`)).map((r) => r.key);
const roleAutorise = roles.includes("pao") ? "pao" : roles[0];
const roleSansDroit = roles.find((r) => r !== roleAutorise && r !== "admin" && r !== "client") ?? roles[1];
const droit = async (roleKey, module, colonne, valeur) =>
  q(
    `update role_permissions set ${colonne} = $3
       where role_id = (select id from roles where key = $1) and module_id = (select id from modules where key = $2)`,
    [roleKey, module, valeur]
  );
await droit(roleAutorise, "patronnage_traces", "can_create", true);
await droit(roleSansDroit, "patronnage_traces", "can_create", false);
await droit(roleSansDroit, "patronnage", "can_view", false);

const pao = await mkUser(roleAutorise);
const autre = await mkUser(roleSansDroit);

const sf = (await one(`insert into product_models(name, nature) values ('Manche test','semi_fini') returning id`)).id;
const art = (await one(`insert into pattern_articles(article_code, designation, product_model_id) values ('MC-T','Manche',$1) returning id`, [sf])).id;
const pat = (await one(`insert into patterns(article_id, size) values ($1,'Homme/M') returning id`, [art])).id;

await test("pièce de patron : rotations {0,180} et symétrie « aucune » par défaut", async () => {
  const p = await one(
    `insert into pattern_pieces(pattern_id, name, expected_count, area, perimeter, radial_signature, points)
     values ($1,'Manche',1,100,40,'[]','[]') returning rotations_autorisees, symetrie`,
    [pat]
  );
  assert.deepEqual(p.rotations_autorisees.map(Number), [0, 180]);
  assert.equal(p.symetrie, "aucune");
});

await test("pièce de patron : angles hors [0, 360[, liste vide et symétrie inconnue refusés", async () => {
  const ins = (rot, sym = "aucune") =>
    q(
      `insert into pattern_pieces(pattern_id, name, expected_count, area, perimeter, radial_signature, points, rotations_autorisees, symetrie)
       values ($1,'X',1,1,1,'[]','[]',$2::numeric[],$3)`,
      [pat, rot, sym]
    );
  await expectFail(() => ins("{360}"));
  await expectFail(() => ins("{-90}"));
  await expectFail(() => ins("{}"));
  await expectFail(() => ins("{0}", "gauche"));
  await ins("{0,90,180,270}", "paire");
});

const calcul = (uid, extra = "") =>
  asRole(
    "authenticated",
    uid,
    `insert into imbrication_calculs(parametres, entree, pieces, temps_total_s, demande_par ${extra ? ", " + extra.split("=")[0] : ""})
     values ('{}','{}','[]',30,$1 ${extra ? ", " + extra.split("=")[1] : ""}) returning id, statut`,
    [uid]
  );

let c1;
await test("personnel autorisé : crée un calcul en son nom, « en attente »", async () => {
  [c1] = await calcul(pao.id ?? pao);
  assert.equal(c1.statut, "en_attente");
});

const uidPao = pao.id ?? pao;
const uidAutre = autre.id ?? autre;

await test("création refusée : sans droit, au nom d'un autre, ou avec un résultat déjà rempli", async () => {
  await expectFail(() => calcul(uidAutre));
  await expectFail(() =>
    asRole("authenticated", uidPao, `insert into imbrication_calculs(parametres, entree, pieces, temps_total_s, demande_par) values ('{}','{}','[]',30,$1)`, [uidAutre])
  );
  await expectFail(() => calcul(uidPao, "meilleur='{}'::jsonb"));
  await expectFail(() => calcul(uidPao, "statut='termine'"));
});

await test("aucune modification directe par le personnel (résultats écrits par le serveur seulement)", async () => {
  const r = await asRole("authenticated", uidPao, `update imbrication_calculs set libelle='x' where id=$1 returning id`, [c1.id]);
  assert.equal(r.length, 0);
});

await test("lecture : réservée au personnel du patronnage", async () => {
  assert.equal((await asRole("authenticated", uidPao, `select id from imbrication_calculs`)).length, 1);
  assert.equal((await asRole("authenticated", uidAutre, `select id from imbrication_calculs`)).length, 0);
});

await test("garde-fou : « terminé » impossible sans tracé validé", async () => {
  await expectFail(() => q(`update imbrication_calculs set statut='termine', meilleur='{}', longueur_mm=1000, validation='{"valide":false}' where id=$1`, [c1.id]));
  await expectFail(() => q(`update imbrication_calculs set statut='termine', meilleur='{}', validation='{"valide":true}' where id=$1`, [c1.id]));
  await expectFail(() => q(`update imbrication_calculs set statut='echec' where id=$1`, [c1.id]));
});

await test("réservation par le serveur : le plus ancien d'abord, jamais deux fois", async () => {
  const [c2] = await calcul(uidPao);
  await expectFail(() => asRole("authenticated", uidPao, `select * from prendre_calcul_imbrication()`));
  const a = await asRole("service_role", null, `select id, statut, reprises_apres_panne from prendre_calcul_imbrication()`);
  assert.equal(a[0].id, c1.id);
  assert.equal(a[0].statut, "en_cours");
  const b = await asRole("service_role", null, `select id from prendre_calcul_imbrication()`);
  assert.equal(b[0].id, c2.id);
  assert.equal((await asRole("service_role", null, `select id from prendre_calcul_imbrication()`)).length, 0);
});

await test("terminé avec un tracé validé : accepté", async () => {
  await q(
    `update imbrication_calculs set statut='termine', meilleur='{"placements":[]}', longueur_mm=2516.2, taux_utilisation=0.9, validation='{"valide":true}', fin_le=now() where id=$1`,
    [c1.id]
  );
});

await test("serveur arrêté en route : calcul repris, puis échec explicite après 3 reprises", async () => {
  const [c3] = await calcul(uidPao);
  await q(`update imbrication_calculs set statut='annule', fin_le=now() where statut in ('en_attente','en_cours') and id<>$1`, [c3.id]);
  for (let i = 1; i <= 3; i++) {
    await q(`update imbrication_calculs set statut='en_cours', vivant_le=now()-interval '10 minutes' where id=$1`, [c3.id]);
    const r = await asRole("service_role", null, `select id, reprises_apres_panne from prendre_calcul_imbrication()`);
    assert.equal(r[0].id, c3.id);
    assert.equal(r[0].reprises_apres_panne, i);
  }
  await q(`update imbrication_calculs set vivant_le=now()-interval '10 minutes' where id=$1`, [c3.id]);
  assert.equal((await asRole("service_role", null, `select id from prendre_calcul_imbrication()`)).length, 0);
  const fin = await one(`select statut, erreur_code from imbrication_calculs where id=$1`, [c3.id]);
  assert.deepEqual([fin.statut, fin.erreur_code], ["echec", "moteur_interrompu"]);
});

await test("annulation : immédiate si en attente, demandée si en cours, refusée si fini ou sans droit", async () => {
  const [c4] = await calcul(uidPao);
  assert.equal((await asRole("authenticated", uidPao, `select annuler_calcul_imbrication($1) r`, [c4.id]))[0].r, "annule");
  const [c5] = await calcul(uidPao);
  await asRole("service_role", null, `select id from prendre_calcul_imbrication()`);
  assert.equal((await asRole("authenticated", uidPao, `select annuler_calcul_imbrication($1) r`, [c5.id]))[0].r, "annulation_demandee");
  assert.ok((await one(`select annulation_demandee_le from imbrication_calculs where id=$1`, [c5.id])).annulation_demandee_le);
  await expectFail(() => asRole("authenticated", uidPao, `select annuler_calcul_imbrication($1)`, [c1.id]));
  await expectFail(() => asRole("authenticated", uidAutre, `select annuler_calcul_imbrication($1)`, [c5.id]));
});

// ---- 0185 : calculs rattachés à un tracé ----
await test("0185 : calcul lancé pour un tracé (groupe de comparaison) ; le tracé garde la trace du calcul retenu", async () => {
  const f = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ('OT-IMB',true,'Imbrication') returning id`);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-IMB-T1') returning id`, [f.id]);
  const groupe = "11111111-2222-3333-4444-555555555555";
  const [c] = await asRole(
    "authenticated",
    uidPao,
    `insert into imbrication_calculs(parametres, entree, pieces, temps_total_s, demande_par, trace_id, groupe)
     values ('{}','{}','[]',30,$1,$2,$3) returning id, trace_id, groupe`,
    [uidPao, t.id, groupe]
  );
  assert.equal(c.trace_id, t.id);
  assert.equal(c.groupe, groupe);
  await q(`update traces_placement set imbrication_calcul_id=$2 where id=$1`, [t.id, c.id]);
  // Le calcul supprimé (purge) ne supprime pas le tracé : le lien tombe.
  await q(`delete from imbrication_calculs where id=$1`, [c.id]);
  assert.equal((await one(`select imbrication_calcul_id from traces_placement where id=$1`, [t.id])).imbrication_calcul_id, null);
  // Le tracé supprimé ne supprime pas l'historique des calculs.
  const [c2] = await asRole(
    "authenticated",
    uidPao,
    `insert into imbrication_calculs(parametres, entree, pieces, temps_total_s, demande_par, trace_id) values ('{}','{}','[]',30,$1,$2) returning id`,
    [uidPao, t.id]
  );
  await q(`delete from traces_placement where id=$1`, [t.id]);
  assert.equal((await one(`select trace_id from imbrication_calculs where id=$1`, [c2.id])).trace_id, null);
});
