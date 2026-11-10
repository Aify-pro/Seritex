// Tests des calculs du module Véhicules (npm run test:vehicules) :
// consommation et contrôles des pleins, entretien dû, coûts par mois.
import assert from "node:assert/strict";
import { analyzeFuelFills, averageConsumption, maintenanceDue, monthlyCosts } from "../src/lib/vehicules/calculs";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}

const settings = { ecartConsommationPct: 25, ecartPrixPct: 10 };
const prices = [
  { energie: "gasoil" as const, prixLitre: 715, depuis: "2026-01-01" },
  { energie: "gasoil" as const, prixLitre: 750, depuis: "2026-10-01" },
];
const vehicle = { energie: "gasoil", reservoirLitres: 60 };

test("plein à plein : distance, consommation et prix au litre", () => {
  const r = analyzeFuelFills(
    [
      { id: "b", datePlein: "2026-10-10T08:00:00Z", litres: 40, montant: 30000, km: 10500 },
      { id: "a", datePlein: "2026-10-01T08:00:00Z", litres: 50, montant: 37500, km: 10000 },
    ],
    vehicle,
    prices,
    settings
  );
  assert.equal(r[0].id, "a");
  assert.equal(r[0].kmParcourus, null);
  assert.equal(r[1].kmParcourus, 500);
  assert.equal(r[1].consommation, 8);
  assert.equal(r[1].prixLitre, 750);
  assert.deepEqual(r[1].anomalies, []);
});

test("contrôles : compteur qui recule, plein sans rouler, litres au-delà du réservoir, prix au litre", () => {
  const r = analyzeFuelFills(
    [
      { id: "a", datePlein: "2026-10-01T08:00:00Z", litres: 40, montant: 30000, km: 10000 },
      { id: "b", datePlein: "2026-10-02T08:00:00Z", litres: 70, montant: 52500, km: 9990 },
      { id: "c", datePlein: "2026-10-03T08:00:00Z", litres: 30, montant: 30000, km: 10000 },
    ],
    vehicle,
    prices,
    settings
  );
  const codes = (id: string) => r.find((x) => x.id === id)!.anomalies.map((a) => a.code);
  assert.deepEqual(codes("b"), ["compteur_recule", "litres_reservoir"]);
  // c : 10 km depuis b, et 1 000 FCFA le litre contre 750.
  assert.deepEqual(codes("c"), ["plein_sans_rouler", "prix_litre"]);
});

test("consommation anormale : comparée à la médiane des autres pleins", () => {
  const fills = [
    { id: "1", datePlein: "2026-10-01T08:00:00Z", litres: 40, montant: 30000, km: 10000 },
    { id: "2", datePlein: "2026-10-05T08:00:00Z", litres: 40, montant: 30000, km: 10500 },
    { id: "3", datePlein: "2026-10-09T08:00:00Z", litres: 40, montant: 30000, km: 11000 },
    { id: "4", datePlein: "2026-10-13T08:00:00Z", litres: 40, montant: 30000, km: 11500 },
    { id: "5", datePlein: "2026-10-17T08:00:00Z", litres: 40, montant: 30000, km: 11750 },
  ];
  const r = analyzeFuelFills(fills, vehicle, prices, settings);
  assert.equal(r[4].consommation, 16);
  assert.deepEqual(r[4].anomalies.map((a) => a.code), ["consommation"]);
  assert.deepEqual(r[2].anomalies, []);
  // Moyenne pondérée : 160 L pour 1 750 km.
  assert.equal(averageConsumption(r, fills), 9.1);
});

test("entretien : dû au premier atteint (date ou km), bientôt, à jour", () => {
  const types = [
    { id: "vid", libelle: "Vidange", intervalleJours: 180, intervalleKm: 5000 },
    { id: "pn", libelle: "Pneus", intervalleJours: null, intervalleKm: 40000 },
    { id: "bat", libelle: "Batterie", intervalleJours: 730, intervalleKm: null },
    { id: "rep", libelle: "Réparation", intervalleJours: null, intervalleKm: null },
    { id: "jamais", libelle: "Freins", intervalleJours: null, intervalleKm: 20000 },
  ];
  const services = [
    { typeId: "vid", date: "2026-08-01", km: 10000 },
    { typeId: "vid", date: "2026-02-01", km: 5000 },
    { typeId: "pn", date: "2025-01-10", km: 2000 },
    { typeId: "bat", date: "2026-01-01", km: null },
    { typeId: "rep", date: "2026-09-01", km: 12000 },
  ];
  const r = maintenanceDue(types, services, 15100, "2026-11-10");
  const by = (id: string) => r.find((x) => x.typeId === id);
  // Vidange : le km est dépassé (15 000) avant la date (28/01/2027).
  assert.equal(by("vid")!.statut, "en_retard");
  assert.equal(by("vid")!.echeanceKm, 15000);
  assert.equal(by("vid")!.echeanceDate, "2027-01-28");
  assert.equal(by("pn")!.statut, "a_jour");
  assert.equal(by("bat")!.statut, "a_jour");
  assert.equal(by("rep"), undefined, "intervention ponctuelle");
  assert.equal(by("jamais"), undefined, "jamais faite : pas de point de départ");
  assert.equal(maintenanceDue(types, services, 14700, "2026-11-10").find((x) => x.typeId === "vid")!.statut, "bientot");
});

test("coûts : par mois et par nature, du plus récent au plus ancien", () => {
  const r = monthlyCosts([
    { date: "2026-10-03", montant: 30000, nature: "carburant" },
    { date: "2026-10-20", montant: 85000, nature: "entretien" },
    { date: "2026-11-02", montant: 25000, nature: "carburant" },
    { date: "2026-11-05", montant: 120000, nature: "documents" },
    { date: "2026-11-06", montant: 0, nature: "documents" },
  ]);
  assert.deepEqual(r.map((m) => m.mois), ["2026-11", "2026-10"]);
  assert.equal(r[0].total, 145000);
  assert.equal(r[1].entretien, 85000);
});

console.log(`\n${n} test(s) OK`);
