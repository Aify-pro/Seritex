// Scénarios SQL de la tâche P-01 : rotations autorisées et symétrie par pièce
// de patron (colonnes pattern_pieces.rotations_autorisees / symetrie, migration
// 0182 ; écriture réservée au droit « Modifier » sur le module « patronnage »,
// politique pattern_pieces_rw réécrite par 0112).
// 1) écriture acceptée pour un rôle autorisé, valeur relue ; défaut à la création ;
// 2) écriture refusée EN BASE pour un rôle sans droit (0 ligne touchée, valeur inchangée) ;
// 3) valeurs invalides refusées par les contraintes ;
// 4) constat : la base accepte tout angle dans [0,360), dont 90°.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const ctx = await setup();
const { db, q, one, as, mkUser, expectFail } = ctx;

/** Exécute une requête en tant qu'utilisateur authentifié (RLS active). */
async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (/row-level security|accès refusé|permission denied/.test(e.message)) return { ok: false, rows: [], msg: e.message };
    throw e;
  } finally {
    await db.exec("reset role");
  }
}
const setRight = (roleKey, moduleKey, col, v) =>
  q(`update role_permissions set ${col} = $3 where role_id=(select id from roles where key=$1) and module_id=(select id from modules where key=$2)`, [roleKey, moduleKey, v]);

const u = {};
for (const k of ["administrateur", "responsable_production", "direction", "commercial", "infographiste"]) u[k] = await mkUser(k);
u.chef_section = await mkUser("chef_section", { section_id: (await one(`select id from sections where name='Coupe'`)).id });

// Un patron et une pièce, créés par l'administrateur (hors RLS : propriétaire).
await as(u.administrateur);
const modele = await one(`insert into product_models(name, nature) values ('Devant rotations','semi_fini') returning id`);
const art = await one(`insert into pattern_articles(article_code, designation, product_model_id) values ('ROT-TEST','T-shirt rotations',$1) returning id`, [modele.id]);
const pat = await one(`insert into patterns(article_id, size) values ($1,'Homme/M') returning id`, [art.id]);
const piece = await one(
  `insert into pattern_pieces(pattern_id, name, area, perimeter, radial_signature, points)
   values ($1,'Devant',1000,130,'[]'::jsonb,'[]'::jsonb) returning id, rotations_autorisees, symetrie`,
  [pat.id]
);
const lire = async () => one(`select rotations_autorisees::text r, symetrie s from pattern_pieces where id=$1`, [piece.id]);
const majRot = (uid, rot) => run(uid, `update pattern_pieces set rotations_autorisees = $2::numeric[] where id=$1 returning rotations_autorisees::text r`, [piece.id, rot]);
const majSym = (uid, sym) => run(uid, `update pattern_pieces set symetrie = $2 where id=$1 returning symetrie`, [piece.id, sym]);

await test("défaut à la création d'une pièce : rotations {0,180}, symétrie « aucune »", async () => {
  assert.equal((await lire()).r, "{0,180}");
  assert.equal(piece.symetrie, "aucune");
});

await test("rôle autorisé (administrateur) : rotations {0}, {180}, {0,180} et symétrie paire/aucune, valeur relue", async () => {
  for (const rot of ["{0}", "{180}", "{0,180}"]) {
    const r = await majRot(u.administrateur, rot);
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1, `administrateur : 1 ligne modifiée pour ${rot}`);
    assert.equal((await lire()).r, rot);
  }
  for (const sym of ["paire", "aucune"]) {
    const r = await majSym(u.administrateur, sym);
    assert.equal(r.rows.length, 1);
    assert.equal((await lire()).s, sym);
  }
});

await test("rôles métier autorisés par la matrice (responsable_production, direction : « Modifier » sur patronnage)", async () => {
  for (const role of ["responsable_production", "direction"]) {
    assert.equal((await majRot(u[role], "{180}")).rows.length, 1, `${role} : rotations`);
    assert.equal((await lire()).r, "{180}");
    assert.equal((await majSym(u[role], "paire")).rows.length, 1, `${role} : symétrie`);
    assert.equal((await lire()).s, "paire");
    // Remise à l'état initial.
    await majRot(u.administrateur, "{0,180}");
    await majSym(u.administrateur, "aucune");
  }
});

await test("rôle sans droit d'écriture : refusé EN BASE (0 ligne touchée, sans erreur), valeur inchangée", async () => {
  // chef_section a « Voir » sur patronnage mais pas « Modifier » ; commercial et infographiste rien.
  for (const role of ["chef_section", "commercial", "infographiste"]) {
    const r = await majRot(u[role], "{0}");
    assert.equal(r.ok, true, `${role} : la RLS filtre en silence (pas d'erreur)`);
    assert.equal(r.rows.length, 0, `${role} : aucune ligne modifiée`);
    const s = await majSym(u[role], "paire");
    assert.equal(s.rows.length, 0, `${role} : symétrie non modifiée`);
    await as(u.administrateur);
    const v = await lire();
    assert.equal(v.r, "{0,180}", `${role} : rotations inchangées (relu en administrateur)`);
    assert.equal(v.s, "aucune", `${role} : symétrie inchangée (relu en administrateur)`);
  }
});

await test("rôle sans droit : création d'une pièce refusée par la RLS (erreur)", async () => {
  const r = await run(
    u.chef_section,
    `insert into pattern_pieces(pattern_id, name, area, perimeter, radial_signature, points, rotations_autorisees)
     values ($1,'Dos',1,1,'[]'::jsonb,'[]'::jsonb,'{0}')`,
    [pat.id]
  );
  assert.equal(r.ok, false);
  assert.match(r.msg, /row-level security/);
});

await test("MATRICE : cocher « Modifier » sur patronnage ouvre l'écriture au commercial, décocher la referme", async () => {
  await setRight("commercial", "patronnage", "can_modify", true);
  assert.equal((await majRot(u.commercial, "{0}")).rows.length, 1);
  await as(u.administrateur);
  assert.equal((await lire()).r, "{0}");
  await setRight("commercial", "patronnage", "can_modify", false);
  assert.equal((await majRot(u.commercial, "{0,180}")).rows.length, 0);
  await as(u.administrateur);
  assert.equal((await lire()).r, "{0}");
  await majRot(u.administrateur, "{0,180}");
});

await test("valeurs invalides refusées par les contraintes (même pour l'administrateur)", async () => {
  const invalides = [
    ["{}", "tableau vide"],
    ["{0,NULL}", "null dans le tableau"],
    ["{360}", "360"],
    ["{-90}", "-90"],
    ["{0,10,20,30,40,50,60,70,80}", "plus de 8 angles"],
  ];
  for (const [rot, cas] of invalides) {
    await expectFail(() => majRot(u.administrateur, rot), /pattern_pieces_rotations_autorisees/).catch((e) => {
      throw new Error(`${cas} : ${e.message}`);
    });
  }
  await expectFail(() => majSym(u.administrateur, "miroir"), /pattern_pieces_symetrie/);
  await expectFail(() => majSym(u.administrateur, null), /null/);
  await expectFail(() => majRot(u.administrateur, null), /null/);
  await as(u.administrateur);
  const v = await lire();
  assert.equal(v.r, "{0,180}");
  assert.equal(v.s, "aucune");
});

await test("valeurs limites admises par la contrainte : 8 angles, 0 et 359.5", async () => {
  assert.equal((await majRot(u.administrateur, "{0,45,90,135,180,225,270,315}")).rows.length, 1);
  assert.equal((await majRot(u.administrateur, "{0,359.5}")).rows.length, 1);
  await majRot(u.administrateur, "{0,180}");
});

await test("constat : la base accepte 90°, seule la Server Action le refuse", async () => {
  // La contrainte 0182 admet tout angle dans [0,360) ; le CLAUDE.md ne retient que 0 et 180.
  // Ce test CONSTATE le comportement actuel ; il devra changer si une contrainte resserre la base.
  const r = await majRot(u.administrateur, "{90}");
  assert.equal(r.rows.length, 1);
  assert.equal((await lire()).r, "{90}");
  await majRot(u.administrateur, "{0,180}");
});

console.log("Rotations et symétrie des pièces de patron : tous les tests passent");
