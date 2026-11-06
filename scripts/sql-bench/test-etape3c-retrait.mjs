// Scénarios SQL de la migration 0156 : l'ancien chemin « t-shirt entier » est
// fermé pour le neuf (réglage réversible), T8 (article à la coupe sans semi-fini
// refusé au lancement de l'ODF), colonne dépréciée retirée, et garde-fous de la
// migration (elle s'arrête sans rien toucher tant que du travail est en cours).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup, test, makeOdf } from "./fixture.mjs";

const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/0156_fermeture_chemin_tshirt_entier.sql");
const M = "Homme/M";

// ---------------------------------------------------------------------------
// Partie 1 : le chemin fermé
// ---------------------------------------------------------------------------
{
  const ctx = await setup({ coupeEntiereFermee: true });
  const { db, q, one, as, mkUser, expectFail } = ctx;
  const admin = await mkUser("administrateur");
  const company = (await one(`insert into companies(name) values ('Client 0156') returning id`)).id;
  await as(admin);
  const manche = await one(`insert into product_models(name, nature) values ('Manche','semi_fini') returning id`);

  await test("fermé : plus de tracé ni de liaison sur une fiche « t-shirt entier » ; l'ordre regroupé reste ouvert", async () => {
    assert.equal((await one(`select coupe_entiere_fermee() f`)).f, true);
    const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 10 } });
    const f = await one(`insert into fiches_placement(numero_ot) values ('OT-ENT-1') returning id`);
    await expectFail(() => q(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-ENT-1-T1')`, [f.id]), /tout se coupe maintenant par pièces/);
    await expectFail(() => q(`insert into fiches_placement(numero_ot, production_order_line_id) values ('OT-ENT-2',$1)`, [o.line.id]), /ne se lie plus à une fiche/);
    const r = await one(`insert into fiches_placement(numero_ot, regroupee) values ('OT-RG-0156', true) returning id`);
    await q(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-RG-0156-T1')`, [r.id]);
  });

  await test("rattrapage : une fiche dont un tracé est terminé accepte encore de nouveaux tracés", async () => {
    await q(`update fabrication_settings set coupe_t_shirt_entier_ferme=false`);
    const f = await one(`insert into fiches_placement(numero_ot) values ('OT-ENT-3') returning id`);
    const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-ENT-3-T1') returning id`, [f.id]);
    await q(`update traces_placement set statut='termine' where id=$1`, [t.id]);
    await q(`update fabrication_settings set coupe_t_shirt_entier_ferme=true`);
    await q(`insert into traces_placement(fiche_id, ordre, reference) values ($1,2,'OT-ENT-3-T2')`, [f.id]);
  });

  await test("réversible : remettre le réglage à faux rouvre l'ancien chemin", async () => {
    await q(`update fabrication_settings set coupe_t_shirt_entier_ferme=false`);
    const f = await one(`insert into fiches_placement(numero_ot) values ('OT-ENT-4') returning id`);
    await q(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-ENT-4-T1')`, [f.id]);
    await q(`update fabrication_settings set coupe_t_shirt_entier_ferme=true`);
  });

  await test("T8 : un article qui passe par la Coupe sans semi-fini dans sa nomenclature ne se lance pas", async () => {
    const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 10 } });
    await q(`select submit_production_order($1)`, [o.po.id]);
    await expectFail(() => q(`select validate_production_order($1)`, [o.po.id]), /aucun semi-fini à tracer/);
    // Avec un semi-fini et un tracé regroupé Bon pour coupe, l'ODF se lance.
    await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG')`, [o.model.id]);
    await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg')`, [o.model.id, manche.id]);
    const f = await one(`insert into fiches_placement(numero_ot, regroupee) values ('OT-RG-T8', true) returning id`);
    await q(`insert into coupe_groupee_lignes(fiche_id, production_order_line_id) values ($1,$2)`, [f.id, o.line.id]);
    const t = await one(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-RG-T8-T1') returning id`, [f.id]);
    await q(`insert into trace_semi_finis(trace_id, semi_fini_id, taille, quantite_par_couche) values ($1,$2,$3,2)`, [t.id, manche.id, M]);
    await q(`insert into trace_couches(trace_id, production_order_line_id, nb_couches) values ($1,$2,5)`, [t.id, o.line.id]);
    await q(`select valider_trace($1)`, [t.id]);
    await q(`select validate_production_order($1)`, [o.po.id]);
    assert.equal((await one(`select status from production_orders where id=$1`, [o.po.id])).status, "en_production");
  });

  await test("un ODF sans coupe (t-shirts achetés) se lance sans tracé ni semi-fini", async () => {
    const o = await makeOdf(ctx, { admin, company, sections: ["Couture"], sizes: { [M]: 10 } });
    await q(`select submit_production_order($1)`, [o.po.id]);
    await q(`select validate_production_order($1)`, [o.po.id]);
    assert.equal((await one(`select status from production_orders where id=$1`, [o.po.id])).status, "en_production");
  });

  await test("colonne dépréciée retirée", async () => {
    const c = await q(`select 1 from information_schema.columns where table_name='fiches_placement' and column_name='semi_fini_id'`);
    assert.equal(c.length, 0);
  });
}

// ---------------------------------------------------------------------------
// Partie 2 : garde-fous de la migration (rejouée sur la base d'avant 0156)
// ---------------------------------------------------------------------------
{
  const ctx = await setup({ upTo: 155 });
  const { db, q, one, as, mkUser, expectFail } = ctx;
  const admin = await mkUser("administrateur");
  const company = (await one(`insert into companies(name) values ('Client garde-fous') returning id`)).id;
  await as(admin);
  const sql = fs.readFileSync(fichier, "utf8");
  const appliquer = () => db.exec(sql);

  // État de départ : un tracé « t-shirt entier » en cours, un article à la Coupe sans semi-fini, un ancien patron.
  const f = await one(`insert into fiches_placement(numero_ot) values ('OT-GF-1') returning id`);
  await q(`insert into traces_placement(fiche_id, ordre, reference) values ($1,1,'OT-GF-1-T1')`, [f.id]);
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: 10 } });
  await db.exec(`alter table pattern_articles disable trigger pattern_articles_semi_fini`);
  const ancien = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ('TS-GF','Ancien', $1) returning id`, [o.model.id]);
  await db.exec(`alter table pattern_articles enable trigger pattern_articles_semi_fini`);

  await test("garde-fou a : des tracés « t-shirt entier » en cours arrêtent la migration, sans rien toucher", async () => {
    await expectFail(appliquer, /0156 NON APPLIQUÉE : 1 tracé/);
    const c = await q(`select 1 from information_schema.columns where table_name='fabrication_settings' and column_name='coupe_t_shirt_entier_ferme'`);
    assert.equal(c.length, 0);
  });

  await test("garde-fou b : un article pas encore lancé qui passe par la Coupe sans semi-fini arrête la migration", async () => {
    await q(`update fiches_placement set statut='archive' where id=$1`, [f.id]);
    await expectFail(appliquer, /0156 NON APPLIQUÉE : 1 article/);
  });

  await test("garde-fou c : un ancien patron de produit fini non repris arrête la migration", async () => {
    const sf = await one(`insert into product_models(name, nature) values ('Manche','semi_fini') returning id`);
    await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG')`, [o.model.id]);
    await q(`insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key) values ($1,'',1,'',$2,'mg')`, [o.model.id, sf.id]);
    await expectFail(appliquer, /0156 NON APPLIQUÉE : 1 ancien\(s\) patron\(s\)|0156 NON APPLIQUÉE : 1 ancien/);
  });

  await test("tout est en ordre : la migration s'applique, le chemin est fermé", async () => {
    await q(`update pattern_articles set migre_le=now() where id=$1`, [ancien.id]);
    await appliquer();
    assert.equal((await one(`select coupe_t_shirt_entier_ferme f from fabrication_settings`)).f, true);
  });
}

console.log("0156 : tous les tests passent");
