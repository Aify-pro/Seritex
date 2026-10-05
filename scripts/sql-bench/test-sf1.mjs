// Scénarios SQL du lot SF-1 (migration 0072) : étapes, déclarations par taille,
// Finition obligatoire, contrôle « jamais plus que l’entrée », bilan de clôture.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { q, one, as, mkUser, expectFail } = ctx;
const sizes = await q(`select cle from sizes where groupe='Homme' order by display_order`);
console.log("tailles:", sizes.map((s) => s.cle).join(", "));
const M = "Homme/M", L = "Homme/L";

const admin = await mkUser("administrateur");
const company = (await one(`insert into companies(name) values ('Client test') returning id`)).id;
await q(`insert into sections(name, display_order, categorie_id) values ('Couture A', 3, (select id from atelier_categories where cle='couture')), ('Couture B', 4, (select id from atelier_categories where cle='couture')) on conflict do nothing`);
await q(`update sections set categorie_id=(select id from atelier_categories where cle='impression') where name='Sérigraphie'`);
const finition = await one(`select s.id, s.name from sections s join atelier_categories ac on ac.id=s.categorie_id where ac.cle='finition'`);
const chefCouture = await mkUser("chef_section", { section_id: (await one(`select id from sections where name='Couture A'`)).id });

await test("la section Finition existe (catégorie finition)", async () => {
  assert.ok(finition, "section finition");
});

let odf;
await test("soumission : la Finition est ajoutée en dernière étape", async () => {
  odf = await makeOdf(ctx, { admin, company, sections: ["Couture A"], sizes: { [M]: 30, [L]: 20 } });
  await as(admin);
  await q(`select submit_production_order($1)`, [odf.po.id]);
  const rows = await q(`select section_categorie_cle(section_id) cat, etape from production_order_line_sections where production_order_line_id=$1 order by etape`, [odf.line.id]);
  assert.deepEqual(rows.map((r) => r.cat), ["couture", "finition"]);
  assert.deepEqual(rows.map((r) => r.etape), [1, 2]);
});

await test("validation : un OT par section, étape recopiée", async () => {
  await q(`select validate_production_order($1)`, [odf.po.id]);
  const wos = await q(`select etape, section_categorie_cle(section_id) cat from work_orders where production_order_line_id=$1 order by etape`, [odf.line.id]);
  assert.deepEqual(wos.map((w) => [w.etape, w.cat]), [[1, "couture"], [2, "finition"]]);
});

const wo = async (cat) => one(`select * from work_orders where production_order_line_id=$1 and section_categorie_cle(section_id)=$2`, [odf.line.id, cat]);

await test("P1 : entrée de l'étape 1 sans coupe = répartition de tailles", async () => {
  const f = await q(`select * from line_stage_flow($1) order by etape, taille`, [odf.line.id]);
  const e1 = f.filter((r) => r.etape === 1);
  assert.deepEqual(e1.map((r) => [r.taille, r.entree, r.en_cours]), [[L, 20, 20], [M, 30, 30]]);
});

await test("la couture ne déclare pas plus que son entrée, taille par taille", async () => {
  const w = await wo("couture");
  await as(chefCouture);
  await q(`select declare_production($1,$2,'bonne',25)`, [w.id, M]);
  await expectFail(() => q(`select declare_production($1,$2,'bonne',6)`, [w.id, M]), /motif pour déclarer un surplus/);
  await q(`select declare_production($1,$2,'dechet',5)`, [w.id, M]);
  await expectFail(() => q(`select declare_production($1,$2,'dechet',1)`, [w.id, M]), /jamais plus/);
  const after = await one(`select quantity_done, quantity_rejected from work_orders where id=$1`, [w.id]);
  assert.equal(after.quantity_done, 25);
  assert.equal(after.quantity_rejected, 5);
});

await test("seule la finition déclare du 2e choix", async () => {
  const w = await wo("couture");
  await as(admin);
  await expectFail(() => q(`select declare_production($1,$2,'deuxieme_choix',1)`, [w.id, M]), /impossible pour une section de catégorie couture/);
  const f = await wo("finition");
  await q(`select declare_production($1,$2,'premier_choix',20)`, [f.id, M]);
  await q(`select declare_production($1,$2,'deuxieme_choix',3)`, [f.id, M]);
  await expectFail(() => q(`select declare_production($1,$2,'premier_choix',3)`, [f.id, M]), /motif pour déclarer un surplus/);
  await expectFail(() => q(`select declare_production($1,$2,'bonne',1)`, [f.id, M]), /impossible/);
});

await test("Entrée = Bonnes + Déchets + En cours, partout", async () => {
  const f = await q(`select * from line_stage_flow($1)`, [odf.line.id]);
  for (const r of f) assert.equal(r.entree, r.bonnes + r.dechets + r.en_cours, JSON.stringify(r));
  const finM = f.find((r) => r.etape === 2 && r.taille === M);
  assert.deepEqual([finM.entree, finM.premier_choix, finM.deuxieme_choix, finM.en_cours], [25, 20, 3, 2]);
});

await test("vue odf_first_choice_by_size", async () => {
  const v = await q(`select * from odf_first_choice_by_size where production_order_line_id=$1`, [odf.line.id]);
  assert.deepEqual(v.map((r) => [r.taille, r.premier_choix]), [[M, 20]]);
});

await test("correction motivée ; l'aval ne peut pas dépasser l'amont corrigé", async () => {
  const decl = await one(`select id from production_declarations where type='bonne' and production_order_line_id=$1`, [odf.line.id]);
  await expectFail(() => q(`select correct_declaration($1, 1, '')`, [decl.id]), /motif/);
  await expectFail(() => q(`select correct_declaration($1, 3, 'erreur')`, [decl.id]), /jamais plus/); // 25-3=22 < 23 déjà en finition
  await q(`select correct_declaration($1, 2, 'erreur de comptage')`, [decl.id]);
  const w = await one(`select quantity_done from work_orders where id=(select work_order_id from production_declarations where id=$1)`, [decl.id]);
  assert.equal(w.quantity_done, 23);
  await expectFail(() => q(`update production_declarations set quantite=1 where id=$1`, [decl.id]), /ne se modifient/);
  await expectFail(() => q(`delete from production_declarations where id=$1`, [decl.id]), /ne se modifient/);
});

await test("demande de clôture : bilan par taille ; refusée tant qu'il reste de l'en-cours (règle SF-4)", async () => {
  await as(admin);
  await expectFail(() => q(`select request_closure($1::uuid)`, [odf.po.id]), /pièce\(s\) en cours/);
  await expectFail(() => q(`select request_closure($1::uuid, 'reste en atelier')`, [odf.po.id]), /donnez une destination/);
  // Chaque reste mis en déchet (SF-4), puis la clôture passe.
  const rows = await q(`select w.id work_order_id, f.taille, f.reste from work_orders w, work_order_flow(w.id) f where w.production_order_id=$1 and f.reste > 0 order by w.etape`, [odf.po.id]);
  for (const r of rows) await q(`select settle_en_cours($1,$2,$3,'dechet','fin de série')`, [r.work_order_id, r.taille, r.reste]);
  const bilan = (await one(`select request_closure($1::uuid, null) b`, [odf.po.id])).b;
  assert.equal(bilan.en_cours, 0);
  const l = bilan.lignes[0].tailles.find((t) => t.taille === M);
  assert.deepEqual([l.demande, l.premier_choix, l.deuxieme_choix], [30, 20, 3]);
  const po = await one(`select status from production_orders where id=$1`, [odf.po.id]);
  assert.equal(po.status, "demande_cloture");
});

await test("Finition seule (vente d'unis, P1) ; Finition pas en dernier = refus", async () => {
  const unis = await makeOdf(ctx, { admin, company, sections: [], sizes: { [M]: 10 } });
  await q(`select submit_production_order($1)`, [unis.po.id]);
  await q(`select validate_production_order($1)`, [unis.po.id]);
  const f = await q(`select * from line_stage_flow($1)`, [unis.line.id]);
  assert.deepEqual(f.map((r) => [r.etape, r.entree]), [[1, 10]]);
  const bad = await makeOdf(ctx, { admin, company, sections: [finition.name, "Couture A"], sizes: { [M]: 10 } });
  await expectFail(() => q(`select submit_production_order($1)`, [bad.po.id]), /Finition doit être/);
});

await test("étape mixte interdite ; parallèle par partie = minimum, par quantité = somme", async () => {
  const mix = await makeOdf(ctx, { admin, company, sizes: { [M]: 10 }, sections: [{ name: "Couture A", etape: 1, partie: "Manches" }, { name: "Couture B", etape: 1 }] });
  await expectFail(() => q(`select submit_production_order($1)`, [mix.po.id]), /mélange/);

  const par = await makeOdf(ctx, { admin, company, sizes: { [M]: 10 }, sections: [{ name: "Couture A", etape: 1, partie: "Manches" }, { name: "Couture B", etape: 1, partie: "Col" }] });
  await q(`select submit_production_order($1)`, [par.po.id]);
  await q(`select validate_production_order($1)`, [par.po.id]);
  const [a, b] = await q(`select w.id from work_orders w join sections s on s.id=w.section_id where w.production_order_line_id=$1 and w.etape=1 order by s.name`, [par.line.id]);
  await q(`select declare_production($1,$2,'bonne',10)`, [a.id, M]);
  await q(`select declare_production($1,$2,'bonne',6)`, [b.id, M]);
  let f = await q(`select * from line_stage_flow($1) where taille=$2 order by etape`, [par.line.id, M]);
  assert.deepEqual(f.map((r) => [r.etape, r.mode, r.entree, r.bonnes, r.en_cours]), [[1, "partie", 10, 6, 4], [2, "quantite", 6, 0, 6]]);

  const qte = await makeOdf(ctx, { admin, company, sizes: { [M]: 10 }, sections: [{ name: "Couture A", etape: 1, quantite: 5 }, { name: "Couture B", etape: 1, quantite: 5 }] });
  await q(`select submit_production_order($1)`, [qte.po.id]);
  await q(`select validate_production_order($1)`, [qte.po.id]);
  const [c, d] = await q(`select w.id from work_orders w join sections s on s.id=w.section_id where w.production_order_line_id=$1 and w.etape=1 order by s.name`, [qte.line.id]);
  await q(`select declare_production($1,$2,'bonne',7)`, [c.id, M]);
  await expectFail(() => q(`select declare_production($1,$2,'bonne',4)`, [d.id, M]), /motif pour déclarer un surplus/);
  await q(`select declare_production_batch($1, $2::jsonb)`, [d.id, JSON.stringify([{ taille: M, type: "bonne", quantite: 3 }])]);
  f = await q(`select * from line_stage_flow($1) where taille=$2 order by etape`, [qte.line.id, M]);
  assert.deepEqual(f.map((r) => [r.etape, r.entree, r.bonnes, r.en_cours]), [[1, 10, 10, 0], [2, 10, 0, 10]]);
});

await test("create_article_lot ne crée plus de mouvement", async () => {
  // Les déclarations de finition en créent (SF-4) ; le lot, aucun.
  const avant = await one(`select count(*)::int n from stock_movements`);
  await q(`select * from create_article_lot($1, null, 'fini', '{"Homme/M": 5}'::jsonb)`, [odf.po.id]);
  const m = await one(`select count(*)::int n from stock_movements`);
  assert.equal(m.n, avant.n);
});

await test("record_work_order_quantity (compatibilité) bornée par l'en-cours", async () => {
  const o = await makeOdf(ctx, { admin, company, sizes: { [M]: 10 }, sections: ["Couture A"] });
  await q(`select submit_production_order($1)`, [o.po.id]);
  await q(`select validate_production_order($1)`, [o.po.id]);
  const w = await one(`select id from work_orders where production_order_line_id=$1 and etape=1`, [o.line.id]);
  await q(`select record_work_order_quantity($1, 8)`, [w.id]);
  await expectFail(() => q(`select record_work_order_quantity($1, 3)`, [w.id]), /dépasse/);
});
console.log("SF-1 : tous les tests passent");
