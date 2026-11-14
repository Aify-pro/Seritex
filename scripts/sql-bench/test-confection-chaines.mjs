// Scénarios SQL du module Confection, lot 1 (migration 0186) : chaînes de
// couture, ravitaillement par scan (livraison entière ou partielle avec
// nouveau paquet), idempotence, retour, pièces complètes ravitaillées, sortie
// de chaîne déclarée au moteur d'ODF (jamais bloquante), rendement par chaîne,
// droits par la matrice.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;
const admin = await mkUser("administrateur");
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client confection') returning id`)).id;
await as(admin);

const couture = await one(`select id from sections where name='Couture'`);
const coupe = await one(`select id from sections where name='Coupe'`);
// La section « Couture » du banc n'a pas de catégorie (en production, elle l'a).
await q(`update sections set categorie_id=(select id from atelier_categories where cle='couture') where id=$1`, [couture.id]);
const manche = await one(`insert into product_models(name, nature) values ('Manche courte','semi_fini') returning id`);
const col = await one(`insert into product_models(name, nature) values ('Col rond','semi_fini') returning id`);

// ODF de 30 t-shirts M : 2 manches + 1 col par pièce, coupés par ordres regroupés.
const A = await makeOdf(ctx, { admin, company, sections: ["Coupe", "Couture"], sizes: { [M]: 30 } });
await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [A.model.id]);
await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg'),($1,'',1,'',$2,'md'),($1,'',1,'',$3,null)`, [A.model.id, manche.id, col.id]);

async function ordre(sf, numero, parCouche, couches) {
  const f = await one(`insert into fiches_placement(numero_ot, regroupee, designation_article) values ($1,true,$2) returning id`, [numero, numero]);
  await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, A.line.id]);
  const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,$2) returning id`, [f.id, numero + "-T1"]);
  await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,$4)`, [t.id, sf.id, M, parCouche]);
  await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,$3)`, [t.id, A.line.id, couches]);
  await q(`select valider_trace($1,'marge')`, [t.id]);
  return t;
}
const tManche = await ordre(manche, "OT-CONF-M", 4, 16); // 64 manches
const tCol = await ordre(col, "OT-CONF-C", 2, 15); // 30 cols
await q(`select submit_production_order($1)`, [A.po.id]);
await q(`select validate_production_order($1)`, [A.po.id]);
const cloturer = (t, sf, n, couches) =>
  one(`select cloturer_matelas_regroupe($1,$2::jsonb,600,180,15,1,$3) r`,
      [t.id, JSON.stringify([{ line_id: A.line.id, couches_reelles: couches, obtenus: { [sf.id]: { [M]: n } } }]), "marge de coupe"]);
await cloturer(tManche, manche, 64, 16);
await cloturer(tCol, col, 30, 15);

const paquet = (sf) => one(`select * from article_lots where production_order_line_id=$1 and semi_fini_id=$2 and statut='en_cours' and chaine_id is null order by created_at limit 1`, [A.line.id, sf.id]);
const woCouture = await one(`select * from work_orders where production_order_line_id=$1 and section_id=$2`, [A.line.id, couture.id]);
const evts = async (type, chaine) => (await one(`select count(*)::int n from article_lot_events where type=$1 and chaine_id=$2`, [type, chaine])).n;

let bon1, bon2, agent, autre;
// Les règles de sécurité ne s'appliquent qu'au rôle « authenticated » (le banc est super-utilisateur).
async function enTantQue(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
}

await test("une chaîne se crée dans une section de couture, avec un code unique", async () => {
  bon1 = await one(`insert into chaines_couture(section_id, nom, code) values ($1,'Bonneterie 1','bon-1') returning *`, [couture.id]);
  bon2 = await one(`insert into chaines_couture(section_id, nom, code, type) values ($1,'Bonneterie 2','BON-2','support') returning *`, [couture.id]);
  assert.equal(bon1.code, "BON-1");
  await expectFail(() => q(`insert into chaines_couture(section_id, nom, code) values ($1,'Coupe 1','COU-1')`, [coupe.id]), /section de couture/);
  await expectFail(() => q(`insert into chaines_couture(section_id, nom, code) values ($1,'Doublon','BON-1')`, [couture.id]), /unique|duplicate/);
});

await test("l'agent ne ravitaille que sa chaîne ; livraison partielle = nouveau paquet, total conservé", async () => {
  agent = await mkUser("agent_chaine", { section_id: couture.id });
  autre = await mkUser("agent_chaine", { section_id: couture.id });
  await q(`insert into chaine_agents(chaine_id, user_id) values ($1,$2)`, [bon1.id, agent]);
  const p = await paquet(manche);
  assert.deepEqual(p.composition_taille, { [M]: 64 });

  await as(autre);
  await expectFail(() => q(`select livrer_paquet_chaine($1,$2,$3::jsonb)`, [p.code, bon1.id, JSON.stringify({ [M]: 20 })]), /pas agent de la chaîne/);
  await as(agent);
  await expectFail(() => q(`select livrer_paquet_chaine($1,$2)`, [p.code, bon2.id]), /pas agent de la chaîne/);
  await expectFail(() => q(`select livrer_paquet_chaine($1,$2,$3::jsonb)`, [p.code, bon1.id, JSON.stringify({ [M]: 99 })]), /ne contient que 64/);

  const r = (await one(`select livrer_paquet_chaine($1,$2,$3::jsonb) r`, [p.code, bon1.id, JSON.stringify({ [M]: 20 })])).r;
  assert.equal(r.nouveau_paquet, true);
  assert.notEqual(r.code, p.code);
  assert.deepEqual([r.composition, r.reste], [{ [M]: 20 }, { [M]: 44 }]);
  const sous = await one(`select * from article_lots where id=$1`, [r.lot_id]);
  assert.deepEqual([sous.parent_lot_id, sous.semi_fini_id, sous.chaine_id], [p.id, manche.id, bon1.id]);

  // Le reste part sur une autre chaîne, en deux fois (division 64 → 20 + 24 + 20).
  await as(admin);
  await q(`select livrer_paquet_chaine($1,$2,$3::jsonb)`, [p.code, bon2.id, JSON.stringify({ [M]: 24 })]);
  const dernier = (await one(`select livrer_paquet_chaine($1,$2) r`, [p.code, bon2.id])).r;
  assert.deepEqual([dernier.nouveau_paquet, dernier.code, dernier.total], [false, p.code, 20]);
  const total = await one(`select sum((composition_taille->>$2)::int)::int n from article_lots where semi_fini_id=$1 and statut='en_cours'`, [manche.id, M]);
  assert.equal(total.n, 64);
  assert.equal(await evts("livraison_chaine", bon1.id), 1);
  assert.equal(await evts("livraison_chaine", bon2.id), 2);
});

await test("le paquet livré entre dans la section : stock tampon de la couture, parcours tracé", async () => {
  const lot = await one(`select id from article_lots where chaine_id=$1 limit 1`, [bon1.id]);
  const det = await one(`select * from lot_detenteur($1)`, [lot.id]);
  assert.deepEqual([det.section_id, det.en_transit], [couture.id, false]);
  const types = (await q(`select type from article_lot_events where article_lot_id=$1 order by created_at, type`, [lot.id])).map((e) => e.type);
  assert.ok(types.includes("decoupage") && types.includes("entree_section") && types.includes("livraison_chaine"));
});

await test("idempotence : le même scan renvoyé ne compte qu'une fois", async () => {
  await as(agent);
  const p = await paquet(col);
  const cle = crypto.randomUUID();
  const a = (await one(`select livrer_paquet_chaine($1,$2,$3::jsonb,null,$4) r`, [p.code, bon1.id, JSON.stringify({ [M]: 10 }), cle])).r;
  const b = (await one(`select livrer_paquet_chaine($1,$2,$3::jsonb,null,$4) r`, [p.code, bon1.id, JSON.stringify({ [M]: 10 }), cle])).r;
  assert.equal(b.deja_enregistre, true);
  assert.equal(a.code, b.code);
  const reste = await one(`select composition_taille from article_lots where id=$1`, [p.id]);
  assert.deepEqual(reste.composition_taille, { [M]: 20 });
});

await test("paquet déjà sur une chaîne : refusé ; retour motivé puis nouvelle livraison", async () => {
  const lot = await one(`select * from article_lots where chaine_id=$1 and semi_fini_id=$2`, [bon1.id, col.id]);
  await expectFail(() => q(`select livrer_paquet_chaine($1,$2)`, [lot.code, bon1.id]), /déjà sur la chaîne Bonneterie 1/);
  await expectFail(() => q(`select retourner_paquet_chaine($1,'')`, [lot.code]), /motif est obligatoire/);
  await q(`select retourner_paquet_chaine($1,'erreur de chaîne')`, [lot.code]);
  let pc = await q(`select * from chaine_pieces_completes($1,$2)`, [bon1.id, A.line.id]);
  assert.equal(pc[0].pieces, 0); // 20 manches mais plus aucun col
  await q(`select livrer_paquet_chaine($1,$2)`, [lot.code, bon1.id]);
  pc = await q(`select * from chaine_pieces_completes($1,$2)`, [bon1.id, A.line.id]);
  // 20 manches ÷ 2 = 10 ; 10 cols ÷ 1 = 10 → 10 t-shirts complets.
  assert.deepEqual([pc[0].taille, pc[0].pieces], [M, 10]);
});

await test("travaux : attribué par le chef (à faire), ouvert au premier paquet (en cours)", async () => {
  const t = await one(`select statut, demarre_le from chaine_travaux where chaine_id=$1 and work_order_id=$2`, [bon1.id, woCouture.id]);
  assert.equal(t.statut, "en_cours");
  assert.ok(t.demarre_le);
  await as(admin);
  const B = await makeOdf(ctx, { admin, company, sections: ["Coupe", "Couture"], sizes: { [M]: 5 } });
  await q(`select submit_production_order($1)`, [B.po.id]).catch(() => {});
});

let sortie;
await test("sortie de chaîne : lot de vêtements montés, déclaration transmise au moteur d'ODF", async () => {
  await as(agent);
  sortie = (await one(`select sortir_chaine($1,$2,$3::jsonb) r`, [bon1.id, woCouture.id, JSON.stringify([
    { taille: M, type: "bonne", quantite: 8 },
    { taille: M, type: "reprise", quantite: 1 },
    { taille: M, type: "rebut", quantite: 1 },
  ])])).r;
  assert.equal(sortie.total, 10);
  assert.deepEqual(sortie.a_regulariser, []);
  assert.deepEqual(sortie.bonnes, { [M]: 8 });
  const lot = await one(`select * from article_lots where id=$1`, [sortie.lot_id]);
  assert.deepEqual([lot.semi_fini_id, lot.composition_taille, lot.production_order_line_id], [null, { [M]: 8 }, A.line.id]);
  const decl = await q(`select d.type, d.quantite, d.article_lot_id from sorties_chaine s join production_declarations d on d.id=s.declaration_id where s.chaine_id=$1 order by d.type`, [bon1.id]);
  assert.deepEqual(decl.map((d) => [d.type, d.quantite]), [["bonne", 8], ["dechet", 1]]);
  assert.equal(decl[0].article_lot_id, sortie.lot_id);
  const reprise = await one(`select declaration_id, declaration_erreur from sorties_chaine where chaine_id=$1 and type='reprise'`, [bon1.id]);
  assert.deepEqual([reprise.declaration_id, reprise.declaration_erreur], [null, null]);
  const wo = await one(`select quantity_done, quantity_rejected from work_orders where id=$1`, [woCouture.id]);
  assert.deepEqual([wo.quantity_done, wo.quantity_rejected], [8, 1]);
});

await test("le moteur refuse ? la sortie est gardée « à régulariser », la chaîne n'est pas bloquée", async () => {
  // 30 t-shirts coupés, 9 déjà sortis : 40 de plus dépasse l'entrée, le moteur exige un motif.
  const r = (await one(`select sortir_chaine($1,$2,$3::jsonb) r`, [bon1.id, woCouture.id, JSON.stringify([{ taille: M, type: "bonne", quantite: 40 }])])).r;
  assert.equal(r.a_regulariser.length, 1);
  assert.match(r.a_regulariser[0].message, /motif/);
  const s = await one(`select id, declaration_id, declaration_erreur from sorties_chaine where chaine_id=$1 and quantite=40`, [bon1.id]);
  assert.equal(s.declaration_id, null);
  assert.ok(s.declaration_erreur);
  await expectFail(() => q(`select regulariser_sortie_chaine($1,'tissu en plus')`, [s.id]), /accès refusé/);
  await as(admin);
  const err = (await one(`select regulariser_sortie_chaine($1,'tissu en plus') r`, [s.id])).r;
  assert.equal(err, null);
  const apres = await one(`select declaration_id from sorties_chaine where id=$1`, [s.id]);
  assert.ok(apres.declaration_id);
});

await test("correction d'un comptage : ligne négative motivée, jamais d'écrasement", async () => {
  const s = await one(`select id from sorties_chaine where chaine_id=$1 and type='bonne' and quantite=8`, [bon1.id]);
  await as(agent);
  await expectFail(() => q(`select corriger_sortie_chaine($1,-2,'recompté')`, [s.id]), /accès refusé/);
  await as(admin);
  await expectFail(() => q(`select corriger_sortie_chaine($1,-2,'')`, [s.id]), /motif est obligatoire/);
  await expectFail(() => q(`select corriger_sortie_chaine($1,-9,'recompté')`, [s.id]), /dépasse/);
  await q(`select corriger_sortie_chaine($1,-2,'recompté')`, [s.id]);
  const net = await one(`select sum(quantite)::int n from sorties_chaine where id=$1 or corrige_id=$1`, [s.id]);
  assert.equal(net.n, 6);
});

await test("rendement du jour : effectif saisi, puis le pointage fait foi", async () => {
  await enTantQue(agent, `insert into presences_chaine(chaine_id, jour, presents) values ($1,current_date,5)`, [bon1.id]);
  await expectFail(() => enTantQue(agent, `insert into presences_chaine(chaine_id, jour, presents) values ($1,current_date,5)`, [bon2.id]), /row-level security/);
  await as(agent);
  let b = await q(`select * from confection_bilan_jour()`);
  assert.deepEqual(b.map((x) => x.code), ["BON-1"]); // l'agent ne voit que sa chaîne
  assert.deepEqual([b[0].presents, b[0].minutes_presence, b[0].source_presence], [5, 2400, "saisie"]);
  // 20 manches + 10 cols livrés ; 8 − 2 + 40 bonnes ; 1 reprise ; 1 rebut.
  assert.deepEqual([b[0].entrees, b[0].sorties, b[0].reprises, b[0].rebuts], [30, 46, 1, 1]);
  assert.equal(b[0].en_cours, 0);
  assert.equal(b[0].a_regulariser, 0);

  await as(admin);
  const e1 = await one(`insert into employes(matricule, nom) values ('0101','Koné') returning id`);
  const e2 = await one(`insert into employes(matricule, nom) values ('0102','Traoré') returning id`);
  for (const e of [e1, e2]) await q(`insert into affectations_couture(employe_id, chaine_id, debut) values ($1,$2, now() - interval '2 days')`, [e.id, bon1.id]);
  await expectFail(() => q(`insert into affectations_couture(employe_id, chaine_id) values ($1,$2)`, [e1.id, bon2.id]), /unique|duplicate/);
  await q(`insert into presences_employes(employe_id, jour, statut, heures) values ($1,current_date,'present',8),($2,current_date,'absent',null)`, [e1.id, e2.id]);
  b = await q(`select * from confection_bilan_jour()`);
  const l1 = b.find((x) => x.code === "BON-1");
  assert.deepEqual([l1.affectes, l1.presents, l1.minutes_presence, l1.source_presence], [2, 1, 480, "pointage"]);
  assert.equal(b.length, 2);
});

await test("personnel proposé à l'affectation sans ouvrir les fiches (ni salaires, ni confidentiels)", async () => {
  await q(`insert into employes(matricule, nom, confidentiel) values ('0900','Direction', true)`);
  const chef = await mkUser("chef_section", { section_id: couture.id });
  await as(chef);
  await db.exec("set role authenticated");
  try {
    const liste = (await db.query(`select * from confection_employes()`)).rows;
    assert.deepEqual(liste.map((e) => e.matricule).sort(), ["0101", "0102"]);
    assert.equal((await db.query(`select id from employes`)).rows.length, 0);
  } finally {
    await db.exec("reset role");
  }
});

await test("droits par la matrice : une case décochée retire réellement l'accès", async () => {
  const commercial = await mkUser("commercial");
  const lire = async (uid, sql) => {
    await as(uid);
    await db.exec("set role authenticated");
    try { return (await db.query(sql)).rows.length; } finally { await db.exec("reset role"); }
  };
  assert.equal(await lire(commercial, `select id from chaines_couture`), 0);
  assert.equal(await lire(commercial, `select id from sorties_chaine`), 0);
  assert.equal(await lire(agent, `select id from chaines_couture`), 2);
  assert.ok((await lire(agent, `select id from sorties_chaine`)) > 0);
  assert.equal(await lire(agent, `select id from confection_cles`).catch(() => 0), 0);

  await as(admin);
  await q(`update role_permissions set can_create=false where role_id=(select id from roles where key='agent_chaine') and module_id=(select id from modules where key='confection_ravitaillement')`);
  await as(agent);
  const p = await paquet(col);
  await expectFail(() => q(`select livrer_paquet_chaine($1,$2)`, [p.code, bon1.id]), /pas agent de la chaîne/);
  await as(admin);
  await q(`update role_permissions set can_create=true where role_id=(select id from roles where key='agent_chaine') and module_id=(select id from modules where key='confection_ravitaillement')`);
  await as(agent);
  await q(`select livrer_paquet_chaine($1,$2)`, [p.code, bon1.id]);

  // L'agent de chaîne n'a que la tablette : aucun autre module ouvert.
  await as(admin);
  const ouverts = (await q(`select m.key from role_permissions rp join modules m on m.id=rp.module_id join roles r on r.id=rp.role_id where r.key='agent_chaine' and (rp.can_view or rp.can_create or rp.can_modify or rp.can_delete or rp.can_validate)`)).map((r) => r.key);
  assert.deepEqual(ouverts, ["confection_ravitaillement"]);
});

await test("un paquet d'un article qui ne passe pas par la section est refusé", async () => {
  await as(admin);
  const C = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 5 } });
  const lot = await one(`insert into article_lots(production_order_id, production_order_line_id, categorie, composition_taille) values ($1,$2,'semi_fini',$3::jsonb) returning code`, [C.po.id, C.line.id, JSON.stringify({ [M]: 5 })]);
  await expectFail(() => q(`select livrer_paquet_chaine($1,$2)`, [lot.code, bon1.id]), /ne passe pas par la section Couture/);
});

console.log("confection lot 1 : tous les scénarios passent");
