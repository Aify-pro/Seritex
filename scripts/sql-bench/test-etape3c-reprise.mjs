// Reprise des données par la migration 0155 : un ordre de coupe regroupé créé
// avec l'ancien modèle (un semi-fini porté par la fiche, une répartition par
// couche sur le tracé) est repris sans perte dans trace_semi_finis.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup, test } from "./fixture.mjs";

const ctx = await setup({ upTo: 154 });
const { db, q, one } = ctx;

const manche = await one(`insert into product_models(name, nature) values ('Manche','semi_fini') returning id`);
const f = await one(`insert into fiches_placement(numero_ot, semi_fini_id, designation_article) values ('OT-OLD',$1,'Manche') returning id`, [manche.id]);
const t = await one(`insert into traces_placement(fiche_id, ordre, reference, repartition_par_couche) values ($1,1,'OT-OLD-T1','{"Homme/M":4,"Homme/L":2,"Homme/S":0}') returning id`, [f.id]);
const entier = await one(`insert into fiches_placement(numero_ot) values ('OT-ENTIER') returning id`);

const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/0155_trace_multi_semi_finis.sql");
await db.exec(fs.readFileSync(fichier, "utf8"));

await test("reprise : l'ancien ordre regroupé devient regroupé, ses pièces sont reprises par taille", async () => {
  assert.equal((await one(`select regroupee from fiches_placement where id=$1`, [f.id])).regroupee, true);
  assert.equal((await one(`select regroupee from fiches_placement where id=$1`, [entier.id])).regroupee, false);
  const r = await q(`select taille, quantite_par_couche, source from trace_semi_finis where trace_id=$1 order by taille`, [t.id]);
  assert.deepEqual(r.map((x) => [x.taille, x.quantite_par_couche, x.source]), [["Homme/L", 2, "saisie"], ["Homme/M", 4, "saisie"]]);
  assert.equal(r.length, 2); // la taille à zéro n'est pas reprise
  assert.equal((await one(`select controle_statut from traces_placement where id=$1`, [t.id])).controle_statut, "non_verifie");
});

console.log("Reprise 0155 : tous les tests passent");
