// Scénarios SQL de la migration 0165 : la couleur de chaque pièce (semi-fini)
// arrive dans les besoins de coupe et dans couleurs_pieces_lignes — couleur
// imposée par la nomenclature, sinon couleur de la zone, sinon couleur unique.
import assert from "node:assert/strict";
import { setup, test, makeOdf } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser } = ctx;
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
const M = "Homme/M";
const company = (await one(`insert into companies(name) values ('Client couleurs') returning id`)).id;
await as(admin);

// Noms propres au test (le référentiel de base contient déjà Rouge, Noir…).
const couleur = async (nom) => (await one(`insert into colors(name, code) values ($1, $1) returning id`, [nom])).id;
const rouge = await couleur("ZRouge");
const bleu = await couleur("ZBleu");
const noir = await couleur("ZNoir");

const corps = await one(`insert into product_models(name, nature) values ('Corps','semi_fini') returning id`);
const manche = await one(`insert into product_models(name, nature) values ('Manche','semi_fini') returning id`);
const col = await one(`insert into product_models(name, nature) values ('Col','semi_fini') returning id`);

// T-shirt : corps (couleur de l'article), 2 manches (zones mg / md), col imposé noir.
async function odf(n) {
  const o = await makeOdf(ctx, { admin, company, sections: ["Coupe"], sizes: { [M]: n } });
  await q(`insert into product_zone_templates(product_model_id, zone_key, zone_label) values ($1,'mg','MG'),($1,'md','MD')`, [o.model.id]);
  await q(
    `insert into nomenclature_lines(product_model_id, designation, quantite_par_piece, unite, semi_fini_id, zone_key, couleur_imposee_id)
     values ($1,'',1,'',$2,null,null),($1,'',1,'',$3,'mg',null),($1,'',1,'',$3,'md',null),($1,'',1,'',$4,null,$5)`,
    [o.model.id, corps.id, manche.id, col.id, noir]
  );
  return o;
}
const A = await odf(10);
const B = await odf(5);
const nomCouleur = async (id) => (await one(`select name from colors where id=$1`, [id])).name;

await test("sans couleur de zone : toutes les pièces prennent la couleur de l'article, sauf la couleur imposée", async () => {
  const blanc = await nomCouleur(A.color.id);
  const r = await q(`select semi_fini_id, couleur_id, couleur from besoins_coupe_agreges() where taille=$1 and $2::text in (select l->>'line_id' from jsonb_array_elements(lignes) l)`, [M, A.line.id]);
  const parPiece = Object.fromEntries(r.map((x) => [x.semi_fini_id, x]));
  assert.equal(parPiece[corps.id].couleur, blanc);
  assert.equal(parPiece[corps.id].couleur_id, A.color.id);
  assert.equal(parPiece[manche.id].couleur, blanc);
  assert.equal(parPiece[col.id].couleur, "ZNoir");
  assert.equal(parPiece[col.id].couleur_id, noir);
});

await test("couleur de zone : les manches prennent la couleur de leur zone", async () => {
  await q(`insert into production_order_line_zone_colors(production_order_line_id, zone_key, color_id) values ($1,'mg',$2),($1,'md',$2)`, [A.line.id, rouge]);
  const m = await one(`select couleur_id, couleur, demandees from besoins_coupe_agreges() where taille=$1 and semi_fini_id=$2 and couleur_id=$3`, [M, manche.id, rouge]);
  assert.deepEqual([m.couleur, m.demandees], ["ZRouge", 20]);
  const ligne = (await one(`select lignes from besoins_coupe_agreges() where taille=$1 and semi_fini_id=$2 and couleur_id=$3`, [M, manche.id, rouge])).lignes[0];
  assert.equal(ligne.couleur, "ZRouge");
});

await test("deux zones de couleurs différentes : pas de couleur_id, les deux noms", async () => {
  await q(`insert into production_order_line_zone_colors(production_order_line_id, zone_key, color_id) values ($1,'mg',$2),($1,'md',$3)`, [B.line.id, rouge, bleu]);
  const m = await one(`select couleur_id, couleur from besoins_coupe_agreges() where taille=$1 and semi_fini_id=$2 and couleur='ZBleu / ZRouge'`, [M, manche.id]);
  assert.equal(m.couleur_id, null);
});

await test("couleurs_pieces_lignes : la couleur de chaque pièce par article", async () => {
  const r = await asAuth(admin, `select line_id, semi_fini_id, couleur from couleurs_pieces_lignes($1)`, [[A.line.id, B.line.id]]);
  const c = (line, sf) => r.find((x) => x.line_id === line && x.semi_fini_id === sf)?.couleur;
  assert.equal(r.length, 6);
  assert.equal(c(A.line.id, manche.id), "ZRouge");
  assert.equal(c(B.line.id, manche.id), "ZBleu / ZRouge");
  assert.equal(c(A.line.id, col.id), "ZNoir");
  assert.equal(c(B.line.id, corps.id), await nomCouleur(B.color.id));
});
