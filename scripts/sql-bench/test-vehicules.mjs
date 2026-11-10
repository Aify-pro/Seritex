// Scénarios SQL (migrations 0168-0172) : module Véhicules, PR 1.
// Droits par la matrice, documents bloquants ou non, immobilisation (tournées,
// expéditions, bons), chauffeur titulaire et remplacements, circuit des bons de
// carburant, pannes et entretien.
import assert from "node:assert/strict";
import { setup, test } from "./fixture.mjs";

const { db, q, one, as, mkUser } = await setup();

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
for (const k of ["administrateur", "responsable_livraison", "comptabilite", "commercial", "livreur"]) u[k] = await mkUser(k);
const admin = u.administrateur;
const logi = u.responsable_livraison;

const emp1 = await one(`insert into employes(matricule, nom, fonction, salaire_base) values ('V001','Koné Ibrahim','Chauffeur',150000) returning id`);
const emp2 = await one(`insert into employes(matricule, nom, fonction) values ('V002','Yao Serge','Chauffeur') returning id`);
const typeId = async (code) => (await one(`select id from vehicle_document_types where code=$1`, [code])).id;

let camion;

await test("droits : le responsable logistique crée un véhicule, le commercial ne le peut pas", async () => {
  const ins = await run(logi, `insert into vehicles(type, libelle, immatriculation, energie, reservoir_litres, usage) values ('camion','Camion 1','2632JP01','gasoil',80,'livraison') returning id`);
  assert.equal(ins.ok, true, ins.msg);
  camion = ins.rows[0].id;
  assert.equal((await run(u.commercial, `insert into vehicles(type, libelle) values ('voiture','X')`)).ok, false);
  assert.equal((await run(u.commercial, `update vehicles set libelle='Y' where id=$1 returning id`, [camion])).rows.length, 0);
  // Lecture inchangée pour le personnel et le livreur (tournées).
  assert.equal((await run(u.livreur, `select id from vehicles`)).rows.length, 1);
  // La comptabilité consulte sans écrire.
  assert.equal((await run(u.comptabilite, `select id from vehicle_documents`)).ok, true);
  assert.equal((await run(u.comptabilite, `insert into vehicle_odometer_readings(vehicle_id, km) values ($1, 10)`, [camion])).ok, false);
});

await test("annuaire : nom et matricule sans salaire, réservé aux droits Véhicules / Bons", async () => {
  const r = await run(logi, `select * from vehicules_annuaire()`);
  assert.equal(r.rows.length, 2);
  assert.equal("salaire_base" in r.rows[0], false);
  assert.equal((await run(u.commercial, `select * from vehicules_annuaire()`)).rows.length, 0);
  assert.equal((await run(logi, `select * from employes`)).rows.length, 0, "la table des salaires reste fermée");
});

await test("compteur : le dernier relevé fait foi", async () => {
  await run(logi, `insert into vehicle_odometer_readings(vehicle_id, km, releve_le) values ($1, 1000, now() - interval '2 days'), ($1, 1200, now() - interval '1 day')`, [camion]);
  assert.equal((await one(`select vehicle_current_km($1) as km`, [camion])).km, 1200);
});

await test("documents : manquant puis valide, à renouveler (J-30), urgent (J-7), expiré", async () => {
  const etat = async () => Object.fromEntries((await run(logi, `select code, statut from vehicle_compliance($1)`, [camion])).rows.map((r) => [r.code, r.statut]));
  assert.equal((await etat()).visite_technique, "manquant");
  await run(logi, `insert into vehicle_documents(vehicle_id, type_id, date_fin) values ($1,$2,current_date + 200)`, [camion, await typeId("visite_technique")]);
  await run(logi, `insert into vehicle_documents(vehicle_id, type_id, date_fin) values ($1,$2,current_date + 20)`, [camion, await typeId("vignette")]);
  await run(logi, `insert into vehicle_documents(vehicle_id, type_id, date_fin) values ($1,$2,current_date + 3)`, [camion, await typeId("carte_stationnement")]);
  await run(logi, `insert into vehicle_documents(vehicle_id, type_id, date_fin) values ($1,$2,current_date - 1)`, [camion, await typeId("assurance")]);
  const e = await etat();
  assert.equal(e.visite_technique, "valide");
  assert.equal(e.vignette, "a_renouveler");
  assert.equal(e.carte_stationnement, "urgent");
  assert.equal(e.assurance, "expire");
  assert.equal(e.patente_transport, "manquant");
});

await test("assurance expirée (non bloquante) et patente manquante : le véhicule reste utilisable", async () => {
  assert.equal((await one(`select vehicle_blocking_reason($1) as r`, [camion])).r, null);
  assert.equal((await run(logi, `insert into delivery_rounds(date, livreur_id, vehicle_id) values (current_date, $1, $2) returning id`, [u.livreur, camion])).ok, true);
});

await test("non concerné : la patente d'un véhicule exempté n'est plus « manquante »", async () => {
  await run(logi, `insert into vehicle_document_exemptions(vehicle_id, type_id, motif) values ($1,$2,'Véhicule de service')`, [camion, await typeId("patente_transport")]);
  const r = await run(logi, `select statut from vehicle_compliance($1) where code='patente_transport'`, [camion]);
  assert.equal(r.rows[0].statut, "non_concerne");
});

await test("visite technique expirée (bloquante) : ni tournée, ni expédition, ni bon de carburant", async () => {
  await run(logi, `insert into vehicle_documents(vehicle_id, type_id, date_debut, date_fin) values ($1,$2,current_date - 400, current_date - 2)`, [camion, await typeId("visite_technique")]);
  // Le document le plus lointain fait foi : encore valide (+200 j).
  assert.equal((await one(`select vehicle_blocking_reason($1) as r`, [camion])).r, null);
  await q(`delete from vehicle_documents where vehicle_id=$1 and type_id=$2 and date_fin > current_date`, [camion, await typeId("visite_technique")]);
  const raison = (await one(`select vehicle_blocking_reason($1) as r`, [camion])).r;
  assert.match(raison, /Visite technique expirée le/);
  const tour = await run(logi, `insert into delivery_rounds(date, livreur_id, vehicle_id) values (current_date, $1, $2)`, [u.livreur, camion]);
  assert.equal(tour.ok, false);
  assert.match(tour.msg, /Véhicule immobilisé/);
  assert.equal((await run(logi, `insert into fuel_vouchers(vehicle_id, montant_demande) values ($1, 20000)`, [camion])).ok, false);
  // La tournée déjà créée garde son véhicule : on ne bloque qu'au changement.
  assert.equal((await run(logi, `update delivery_rounds set notes='ok' where vehicle_id=$1 returning id`, [camion])).rows.length, 1);
  // Rendre le type non bloquant (Paramètres) lève l'immobilisation.
  await run(admin, `update vehicle_document_types set bloquant=false where code='visite_technique'`);
  assert.equal((await one(`select vehicle_blocking_reason($1) as r`, [camion])).r, null);
  await run(admin, `update vehicle_document_types set bloquant=true where code='visite_technique'`);
  await run(logi, `insert into vehicle_documents(vehicle_id, type_id, date_fin) values ($1,$2,current_date + 365)`, [camion, await typeId("visite_technique")]);
  assert.equal((await one(`select vehicle_blocking_reason($1) as r`, [camion])).r, null);
});

await test("paramètres : seul le droit « Paramètres véhicules » change un type de document", async () => {
  assert.equal((await run(u.commercial, `update vehicle_document_types set preavis_jours=10 returning id`)).rows.length, 0);
  assert.equal((await run(logi, `update vehicle_document_types set urgence_jours=40, preavis_jours=30 where code='vignette'`)).ok, false, "urgence > préavis");
});

await test("chauffeur : un titulaire à la fois, remplacement prioritaire sur sa période", async () => {
  assert.equal((await run(logi, `select set_vehicle_titulaire($1,$2,current_date - 100)`, [camion, emp1.id])).ok, true);
  assert.equal((await run(logi, `insert into vehicle_assignments(vehicle_id, employe_id, type, debut) values ($1,$2,'titulaire',current_date)`, [camion, emp2.id])).ok, false, "deux titulaires");
  await run(logi, `insert into vehicle_assignments(vehicle_id, employe_id, type, debut, fin, motif) values ($1,$2,'remplacement',current_date - 10, current_date - 5,'Congé')`, [camion, emp2.id]);
  assert.equal((await one(`select vehicle_driver_at($1, current_date - 7) as e`, [camion])).e, emp2.id);
  assert.equal((await one(`select vehicle_driver_at($1, current_date - 2) as e`, [camion])).e, emp1.id);
  // Changement de titulaire : l'ancien est clôturé la veille.
  assert.equal((await run(logi, `select set_vehicle_titulaire($1,$2,current_date)`, [camion, emp2.id])).ok, true);
  assert.equal((await one(`select vehicle_driver_at($1, current_date - 1) as e`, [camion])).e, emp1.id);
  assert.equal((await one(`select vehicle_driver_at($1, current_date) as e`, [camion])).e, emp2.id);
  assert.equal((await run(u.commercial, `select set_vehicle_titulaire($1,$2,current_date + 5)`, [camion, emp1.id])).ok, false);
});

let bon;
await test("bon de carburant : demande, validation numérotée, justification avec relevé de compteur", async () => {
  const ins = await run(logi, `insert into fuel_vouchers(vehicle_id, beneficiaire_id, montant_demande, km_demande, motif) values ($1,$2,30000,1250,'Tournée Yopougon') returning id`, [camion, emp2.id]);
  assert.equal(ins.ok, true, ins.msg);
  bon = ins.rows[0].id;
  assert.equal((await run(logi, `insert into fuel_vouchers(vehicle_id, montant_demande, statut) values ($1, 1000, 'valide')`, [camion])).ok, false, "création directe à l'état validé");
  assert.equal((await run(u.comptabilite, `select validate_fuel_voucher($1)`, [bon])).ok, false, "la comptabilité ne valide pas");
  assert.equal((await run(logi, `select justify_fuel_voucher($1, now(), 30000, 40, 1300)`, [bon])).ok, false, "pas de justification avant validation");
  const v = await run(logi, `select validate_fuel_voucher($1) as numero`, [bon]);
  assert.match(v.rows[0].numero, /^BC-\d{4}-0001$/);
  assert.equal((await run(logi, `update fuel_vouchers set montant_demande=50000 where id=$1 returning id`, [bon])).rows.length, 0, "un bon validé ne se modifie plus");
  assert.equal((await run(logi, `select justify_fuel_voucher($1, now() - interval '1 hour', 29500, 38.5, 1310)`, [bon])).ok, true);
  const b = await one(`select statut, litres, km_plein from fuel_vouchers where id=$1`, [bon]);
  assert.equal(b.statut, "justifie");
  assert.equal((await one(`select vehicle_current_km($1) as km`, [camion])).km, 1310);
  // Correction de la justification : le relevé est remplacé, pas doublé.
  await run(logi, `select justify_fuel_voucher($1, now() - interval '1 hour', 29500, 38.5, 1305)`, [bon]);
  assert.equal((await one(`select count(*)::int as n from vehicle_odometer_readings where source='carburant'`)).n, 1);
  assert.equal((await run(logi, `select cancel_fuel_voucher($1, 'erreur')`, [bon])).ok, false, "un bon justifié ne s'annule pas");
});

await test("bons : plafond, refus motivé, annulation, numéro suivant", async () => {
  await run(admin, `update vehicules_reglages set plafond_bon = 50000`);
  const gros = (await run(logi, `insert into fuel_vouchers(vehicle_id, montant_demande) values ($1, 80000) returning id`, [camion])).rows[0].id;
  assert.equal((await run(logi, `select validate_fuel_voucher($1)`, [gros])).ok, false);
  assert.equal((await run(logi, `select refuse_fuel_voucher($1, '')`, [gros])).ok, false, "refus sans motif");
  assert.equal((await run(logi, `select refuse_fuel_voucher($1, 'Au-dessus du plafond')`, [gros])).ok, true);
  const b2 = (await run(logi, `insert into fuel_vouchers(vehicle_id, montant_demande) values ($1, 20000) returning id`, [camion])).rows[0].id;
  assert.match((await run(logi, `select validate_fuel_voucher($1) as n`, [b2])).rows[0].n, /-0002$/);
  assert.equal((await run(logi, `select cancel_fuel_voucher($1, 'Mission annulée')`, [b2])).ok, true);
});

await test("panne immobilisante : véhicule en panne, puis remis en service par l'intervention qui la clôt", async () => {
  const p = await run(logi, `insert into vehicle_issues(vehicle_id, description, gravite, conducteur_id) values ($1,'Embrayage HS','immobilisante',$2) returning id`, [camion, emp2.id]);
  assert.equal(p.ok, true, p.msg);
  assert.equal((await one(`select statut from vehicles where id=$1`, [camion])).statut, "en_panne");
  assert.match((await one(`select vehicle_blocking_reason($1) as r`, [camion])).r, /en panne/);
  assert.equal((await run(logi, `insert into fuel_vouchers(vehicle_id, montant_demande) values ($1, 10000)`, [camion])).ok, false);
  const rep = (await one(`select id from vehicle_service_types where code='reparation'`)).id;
  assert.equal((await run(logi, `insert into vehicle_services(vehicle_id, type_id, km, cout, garage, issue_id) values ($1,$2,1400,85000,'Garage du Plateau',$3)`, [camion, rep, p.rows[0].id])).ok, true);
  assert.equal((await one(`select statut from vehicle_issues where id=$1`, [p.rows[0].id])).statut, "resolue");
  assert.equal((await one(`select statut from vehicles where id=$1`, [camion])).statut, "en_service");
  assert.equal((await one(`select vehicle_current_km($1) as km`, [camion])).km, 1400);
});

await test("un véhicule immobilisé par décision humaine n'est pas remis en service par une panne close", async () => {
  await run(logi, `update vehicles set statut='immobilise' where id=$1`, [camion]);
  const p = (await run(logi, `insert into vehicle_issues(vehicle_id, description, gravite) values ($1,'Rétroviseur cassé','mineure') returning id`, [camion])).rows[0].id;
  await run(logi, `update vehicle_issues set statut='resolue', resolue_le=now() where id=$1`, [p]);
  assert.equal((await one(`select statut from vehicles where id=$1`, [camion])).statut, "immobilise");
  assert.match((await one(`select vehicle_blocking_reason($1) as r`, [camion])).r, /immobilisé/);
});

await test("droits par défaut : la matrice a bien reçu les nouveaux modules", async () => {
  const rows = await q(`
    select r.base_role::text as role, m.key, rp.can_view, rp.can_create, rp.can_validate
    from role_permissions rp join roles r on r.id = rp.role_id join modules m on m.id = rp.module_id
    where m.key in ('vehicules','bons_carburant','parametres_vehicules') and r.key = r.base_role::text`);
  const get = (role, key) => rows.find((x) => x.role === role && x.key === key);
  assert.equal(get("responsable_livraison", "bons_carburant").can_validate, true);
  assert.equal(get("comptabilite", "vehicules").can_view, true);
  assert.equal(get("comptabilite", "vehicules").can_create, false);
  assert.equal(get("commercial", "vehicules").can_view, false);
});

await test("lecture groupée : état des documents de tout le parc, raisons d'immobilisation pour le personnel seulement", async () => {
  const all = await run(logi, `select vehicle_id, code, statut from vehicles_compliance_all()`);
  assert.equal(all.rows.filter((r) => r.vehicle_id === camion).length, 5);
  const r = await run(logi, `select * from vehicles_blocking_reasons()`);
  assert.equal(r.rows.length, 1, "le camion est immobilisé (décision humaine)");
  assert.equal((await run(u.livreur, `select * from vehicles_blocking_reasons()`)).rows.length, 0);
});
