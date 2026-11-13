// Scénarios SQL des agents IA (migration 0187) : jetons gérés par
// l'administrateur de la plateforme, révocation définitive, journal écrit
// par le serveur seulement, et fonctions « au nom du propriétaire »
// réservées au serveur, qui appliquent les droits du propriétaire.
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
const roleMetier = roles.includes("pao") ? "pao" : roles.find((r) => r !== "administrateur" && r !== "client");
const roleSansDroit = roles.find((r) => ![roleMetier, "administrateur", "client", "chef_section", "livreur"].includes(r));
const droit = (roleKey, module, colonne, valeur) =>
  q(
    `update role_permissions set ${colonne} = $3 where role_id = (select id from roles where key = $1) and module_id = (select id from modules where key = $2)`,
    [roleKey, module, valeur]
  );
await droit(roleMetier, "patronnage", "can_view", true);
await droit(roleMetier, "patronnage_traces", "can_create", true);
await droit(roleSansDroit, "patronnage", "can_view", false);
await droit(roleSansDroit, "patronnage_traces", "can_create", false);

const admin = await mkUser("administrateur");
const pao = await mkUser(roleMetier);
const autre = await mkUser(roleSansDroit);
const empreinte = (c) => c.repeat(64);

const creer = (uid, extra = {}) =>
  asRole(
    "authenticated",
    uid,
    `insert into agents_ia(nom, empreinte_jeton, prefixe_jeton, droits, proprietaire, cree_par)
     values ($1, $2, 'stx_agent_ab', $3::text[], $4, $5) returning id`,
    [extra.nom ?? "Claude coupe", extra.empreinte ?? empreinte("a"), extra.droits ?? "{lecture,calcul}", extra.proprietaire ?? pao, extra.cree_par ?? uid]
  );

let agent;
await test("administrateur de la plateforme : crée un agent (empreinte seule, droits, propriétaire)", async () => {
  [agent] = await creer(admin);
  const a = await one(`select droits, actif, proprietaire from agents_ia where id=$1`, [agent.id]);
  assert.deepEqual(a.droits, ["lecture", "calcul"]);
  assert.equal(a.actif, true);
  assert.equal(a.proprietaire, pao);
});

await test("personne d'autre ne crée ni ne voit d'agent ; droits, empreinte et nom contrôlés", async () => {
  await expectFail(() => creer(pao, { nom: "Autre", empreinte: empreinte("b") }));
  assert.equal((await asRole("authenticated", pao, `select id from agents_ia`)).length, 0);
  await expectFail(() => creer(admin, { nom: "Droit inconnu", empreinte: empreinte("c"), droits: "{lecture,valider}" }));
  await expectFail(() => creer(admin, { nom: "Sans droit", empreinte: empreinte("d"), droits: "{}" }));
  await expectFail(() => creer(admin, { nom: "Jeton en clair", empreinte: "stx_agent_123" }));
  await expectFail(() => creer(admin, { nom: "claude COUPE", empreinte: empreinte("e") }));
});

await test("révocation définitive : ni réactivation, ni changement de jeton", async () => {
  const [a2] = await creer(admin, { nom: "Agent révoqué", empreinte: empreinte("f") });
  await asRole("authenticated", admin, `update agents_ia set actif=false, revoque_le=now(), revoque_par=$2 where id=$1`, [a2.id, admin]);
  await expectFail(() => asRole("authenticated", admin, `update agents_ia set actif=true, revoque_le=null where id=$1`, [a2.id]), /révoqué/);
  await expectFail(() => asRole("authenticated", admin, `update agents_ia set empreinte_jeton=$2 where id=$1`, [agent.id, empreinte("9")]), /jeton/);
});

await test("journal : écrit par le serveur seulement, lu par le patronnage", async () => {
  await expectFail(() => asRole("authenticated", pao, `insert into agents_ia_journal(agent_id, outil, statut) values ($1,'x','ok')`, [agent.id]));
  await asRole("service_role", null, `insert into agents_ia_journal(agent_id, outil, arguments, statut, duree_ms) values ($1,'planifier_coupe','{}','ok',12)`, [agent.id]);
  assert.equal((await asRole("authenticated", pao, `select outil from agents_ia_journal`)).length, 1);
  assert.equal((await asRole("authenticated", autre, `select outil from agents_ia_journal`)).length, 0);
});

await test("au nom du propriétaire : droits du propriétaire, serveur seulement", async () => {
  const d = async (uid, module, action) => (await asRole("service_role", null, `select agent_a_le_droit($1,$2,$3) v`, [uid, module, action]))[0].v;
  assert.equal(await d(pao, "patronnage_traces", "create"), true);
  assert.equal(await d(autre, "patronnage_traces", "create"), false);
  assert.equal(await d(null, "patronnage", "view"), false);
  await q(`update app_users set active=false where id=$1`, [pao]);
  assert.equal(await d(pao, "patronnage", "view"), false, "propriétaire désactivé : plus aucun droit");
  await q(`update app_users set active=true where id=$1`, [pao]);
  await expectFail(() => asRole("authenticated", pao, `select agent_a_le_droit($1,'patronnage','view')`, [pao]));
  await expectFail(() => asRole("authenticated", pao, `select besoins_coupe_agent($1)`, [pao]));
});

await test("besoins de coupe au nom du propriétaire : la liste (vide ici) pour qui a le droit", async () => {
  const [r] = await asRole("service_role", null, `select besoins_coupe_agent($1) v`, [pao]);
  assert.ok(Array.isArray(r.v));
  const [r2] = await asRole("service_role", null, `select reservations_rouleaux_agent($1) v`, [pao]);
  assert.ok(Array.isArray(r2.v));
});

await test("calcul lancé par un agent : rattaché à l'agent", async () => {
  const [c] = await asRole(
    "service_role",
    null,
    `insert into imbrication_calculs(parametres, entree, pieces, temps_total_s, demande_par, demande_par_agent, agent_id)
     values ('{}','{}','[]',30,$1,'Claude coupe',$2) returning agent_id`,
    [pao, agent.id]
  );
  assert.equal(c.agent_id, agent.id);
  // Le personnel ne peut pas se faire passer pour un agent.
  await expectFail(() =>
    asRole("authenticated", pao, `insert into imbrication_calculs(parametres, entree, pieces, temps_total_s, demande_par, demande_par_agent) values ('{}','{}','[]',30,$1,'faux')`, [pao])
  );
});
