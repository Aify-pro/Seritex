// Scénarios SQL (migrations 0173-0176) : module Véhicules, PR 2.
// Mot de passe FreeTrack dans le Vault (jamais lisible par l'écran), positions
// et trajets, km GPS, alertes (traitement seulement), rapprochement remis à
// zéro par une correction, sinistres et amendes avec conducteur retrouvé.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

// Vault minimal (Supabase le fournit ; absent de PGlite).
await db.exec(`
  create schema if not exists vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, description text, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
    language sql as $$ insert into vault.secrets(secret, name, description) values (new_secret, new_name, new_description) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text) returns void
    language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
`);

async function run(uid, sql, params) {
  await as(uid);
  await db.exec("set role authenticated");
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    if (["P0001", "P0002", "42501"].includes(e.code) || /row-level security|violates|permission denied/i.test(e.message)) {
      return { ok: false, rows: [], msg: e.message };
    }
    throw e;
  } finally {
    await db.exec("reset role");
  }
}

const u = {};
for (const k of ["administrateur", "responsable_livraison", "commercial"]) u[k] = await mkUser(k);
// L'administrateur de la plateforme (0026).
const adminCol = await one(`select column_name from information_schema.columns where table_name='app_users' and column_name in ('is_platform_admin','platform_admin') limit 1`);
if (adminCol) await q(`update app_users set ${adminCol.column_name} = true where id = $1`, [u.administrateur]);
const logi = u.responsable_livraison;

await as(logi);
const v = (await run(logi, `insert into vehicles(type, libelle, immatriculation, freetrack_device_id) values ('camion','Camion 1','9976KB01',3356) returning id`)).rows[0].id;
const emp = await one(`insert into employes(matricule, nom) values ('G1','Konan') returning id`);
await run(logi, `select set_vehicle_titulaire($1,$2,current_date - 30)`, [v, emp.id]);

await test("mot de passe FreeTrack : chiffré dans le Vault, jamais lisible depuis l'écran", async () => {
  const isAdmin = (await run(u.administrateur, `select is_platform_admin() as a`)).rows[0].a;
  console.log("  (administrateur de plateforme dans le banc :", isAdmin, ")");
  assert.equal((await run(logi, `select freetrack_set_password('secret123')`)).ok, false, "réservé à l'administrateur de la plateforme");
  if (isAdmin) {
    assert.equal((await run(u.administrateur, `select freetrack_set_password('secret123')`)).ok, true);
    const s = (await run(u.administrateur, `select * from freetrack_settings`)).rows[0];
    assert.ok(s.password_secret_id && s.password_set_at);
    assert.equal(Object.values(s).includes("secret123"), false);
    // Remplacement : même secret mis à jour, pas un nouveau.
    await run(u.administrateur, `select freetrack_set_password('autre456')`);
    assert.equal((await one(`select count(*)::int as n from vault.secrets`)).n, 1);
  }
  // Lecture des identifiants : clé de service seulement.
  assert.equal((await run(u.administrateur, `select * from freetrack_credentials()`)).ok, false);
  assert.equal((await run(logi, `select * from freetrack_session`)).ok, false);
  // L'écran ne peut pas écrire la référence du secret.
  assert.equal((await run(u.administrateur, `update freetrack_settings set password_secret_id = gen_random_uuid()`)).ok, false);
});

await test("positions et trajets : lus avec le droit Véhicules, jamais écrits par l'écran ; km GPS par jour et entre deux instants", async () => {
  await q(`insert into vehicle_positions(vehicle_id, device_id, latitude, longitude, vitesse, signal_le) values ($1, 3356, 5.33, -3.98, 66, now())`, [v]);
  await q(`insert into vehicle_gps_segments(vehicle_id, type, debut, fin, duree_s, distance_km, vitesse_max) values
    ($1,'trajet', now() - interval '3 hours', now() - interval '2 hours', 3600, 40.5, 82),
    ($1,'arret',  now() - interval '2 hours', now() - interval '1 hour', 3600, 0, 0),
    ($1,'trajet', now() - interval '1 hour', now(), 3600, 12.3, 60)`, [v]);
  assert.equal((await run(logi, `select * from vehicle_positions`)).rows.length, 1);
  assert.equal((await run(u.commercial, `select * from vehicle_positions`)).rows.length, 0);
  assert.equal((await run(logi, `insert into vehicle_gps_segments(vehicle_id, type, debut) values ($1,'trajet',now())`, [v])).ok, false);
  const day = (await run(logi, `select km, trajets from vehicle_gps_days where vehicle_id=$1`, [v])).rows;
  assert.ok(day.length >= 1);
  assert.equal(Number(day.reduce((s, d) => s + Number(d.km), 0).toFixed(1)), 52.8);
  assert.equal(Number((await one(`select vehicle_gps_km($1, now() - interval '90 minutes', now()) as k`, [v])).k), 12.3);
});

await test("alertes : règles réglables par Paramètres, alertes traitées sans pouvoir changer leur contenu", async () => {
  assert.equal((await run(logi, `update vehicle_alert_rules set parametres = '{"seuil_kmh": 80, "seuil_moto_kmh": 60}' where code='exces_vitesse' returning code`)).rows.length, 1);
  assert.equal((await run(u.commercial, `update vehicle_alert_rules set actif=false returning code`)).rows.length, 0);
  const ev = await one(`insert into vehicle_alert_events(rule_code, vehicle_id, survenue_le, valeur, message, dedupe_key) values ('exces_vitesse',$1,now(),95,'95 km/h','k1') returning id`, [v]);
  assert.equal((await run(logi, `update vehicle_alert_events set statut='classee', commentaire='Chauffeur prévenu', traite_par=$2, traite_le=now() where id=$1 returning id`, [ev.id, logi])).rows.length, 1);
  assert.equal((await run(logi, `update vehicle_alert_events set message='rien' where id=$1`, [ev.id])).ok, false);
  assert.equal((await run(logi, `insert into vehicle_alert_events(rule_code, vehicle_id, survenue_le, message, dedupe_key) values ('exces_vitesse',$1,now(),'x','k2')`, [v])).ok, false);
  assert.equal((await one(`select count(*)::int as n from vehicle_alert_rules`)).n, 7);
});

await test("rapprochement : une correction du plein efface la vérification GPS", async () => {
  const b = (await run(logi, `insert into fuel_vouchers(vehicle_id, montant_demande) values ($1, 20000) returning id`, [v])).rows[0].id;
  await run(logi, `select validate_fuel_voucher($1)`, [b]);
  await run(logi, `select justify_fuel_voucher($1, now() - interval '30 minutes', 20000, 26, 15000)`, [b]);
  await q(`update fuel_vouchers set gps_km = 52.8, gps_distance_station_m = 120, gps_verifie_le = now() where id=$1`, [b]);
  await run(logi, `select justify_fuel_voucher($1, now() - interval '30 minutes', 20000, 26, 15010)`, [b]);
  const r = await one(`select gps_km, gps_verifie_le from fuel_vouchers where id=$1`, [b]);
  assert.equal(r.gps_km, null);
  assert.equal(r.gps_verifie_le, null);
});

await test("sinistre et amende : conducteur retrouvé par l'affectation à la date", async () => {
  const s = await run(logi, `insert into vehicle_incidents(vehicle_id, survenu_le, description, cout_reel, rembourse) values ($1, now() - interval '2 days','Accrochage parking',150000,100000) returning conducteur_id, conducteur_auto`, [v]);
  assert.equal(s.ok, true, s.msg);
  assert.equal(s.rows[0].conducteur_id, emp.id);
  assert.equal(s.rows[0].conducteur_auto, true);
  const a = await run(logi, `insert into vehicle_fines(vehicle_id, commise_le, motif, montant) values ($1, now() - interval '1 day','Excès de vitesse',25000) returning conducteur_id`, [v]);
  assert.equal(a.rows[0].conducteur_id, emp.id);
  // Avant toute affectation : pas de conducteur trouvé.
  const avant = await run(logi, `insert into vehicle_fines(vehicle_id, commise_le, motif, montant) values ($1, now() - interval '90 days','Stationnement',5000) returning conducteur_id, conducteur_auto`, [v]);
  assert.equal(avant.rows[0].conducteur_id, null);
  assert.equal(avant.rows[0].conducteur_auto, false);
  assert.equal((await run(u.commercial, `select * from vehicle_fines`)).rows.length, 0);
});
