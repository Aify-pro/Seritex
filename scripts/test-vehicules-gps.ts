// Tests de la PR 2 du module Véhicules (npm run test:vehicules) : lecture des
// réponses FreeTrack (GPSWOX), alertes GPS, rapprochement carburant / GPS.
// Les réponses ci-dessous reprennent la forme réelle de l'API (champs utiles).
import assert from "node:assert/strict";
import { distanceM, normalizePlate, parseDevices, parseGpswoxDate, parseHistory, looksLikeMoto } from "../src/lib/vehicules/freetrack-parse";
import { evaluateGpsRules, inWorkHours, type AlertRule } from "../src/lib/vehicules/gps-alerts";
import { analyzeFuelFills, fuelGpsCheck } from "../src/lib/vehicules/calculs";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}

test("FreeTrack : traceurs, immatriculations, moteur et odomètre", () => {
  const devices = parseDevices([
    {
      title: "Traceurs",
      items: [
        {
          id: 3356,
          name: "9976KB01*",
          online: "online",
          timestamp: 1794325461,
          lat: 5.336077,
          lng: -3.983388,
          speed: 66,
          course: 120,
          address: "-",
          stop_duration_sec: 0,
          sensors: [
            { type: "engine", value: "On" },
            { type: "odometer", value: "24591 km" },
          ],
        },
        { id: 3416, name: "AA-638-AL*(MOTO)", online: "ack", time: "10-11-2026 15:45:29", lat: "5.2925", lng: "-3.9469", speed: 0, sensors: [] },
        { id: 9, name: "sans position" },
      ],
    },
  ]);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].vitesse, 66);
  assert.equal(devices[0].moteur, true);
  assert.equal(devices[0].odometreKm, 24591);
  assert.equal(devices[0].adresse, null);
  assert.match(devices[0].signalLe!, /^2026-11-1\dT/);
  assert.equal(devices[1].signalLe, "2026-11-10T15:45:29Z");
  assert.equal(normalizePlate("AA-638-AL*(MOTO)"), "AA638AL");
  assert.equal(normalizePlate(" 2632 jp 01* "), "2632JP01");
  assert.equal(looksLikeMoto("CH0453* (MOTO)"), true);
  assert.equal(parseGpswoxDate("31-12-2026 23:59:59"), "2026-12-31T23:59:59Z");
});

test("FreeTrack : historique en trajets et arrêts (début et fin ignorés)", () => {
  const segs = parseHistory({
    items: [
      { status: 3, show: "10-11-2026 00:01:02", items: [{}] },
      { status: 2, show: "10-11-2026 00:01:02", left: "10-11-2026 07:33:51", time_seconds: 27169, distance: 0, items: [{ lat: 5.36, lng: -4.07 }] },
      {
        status: 1,
        show: "10-11-2026 07:33:51",
        left: "10-11-2026 08:08:36",
        time_seconds: 2085,
        distance: 8.71,
        top_speed: 61,
        average_speed: 22,
        items: [{ lat: 5.36, lng: -4.07 }, { lat: 5.33, lng: -4.0 }],
      },
      { status: 4, show: "10-11-2026 16:00:00", items: [] },
    ],
  });
  assert.equal(segs.length, 2);
  assert.equal(segs[0].type, "arret");
  assert.equal(segs[1].type, "trajet");
  assert.equal(segs[1].distanceKm, 8.71);
  assert.equal(segs[1].latitudeFin, 5.33);
  assert.equal(segs[1].debut, "2026-11-10T07:33:51Z");
});

const rules: AlertRule[] = [
  { code: "exces_vitesse", actif: true, gravite: "critique", parametres: { seuil_kmh: 90, seuil_moto_kmh: 70 }, usages: [] },
  { code: "hors_heures", actif: true, gravite: "attention", parametres: { debut: "06:00", fin: "20:00", jours: [1, 2, 3, 4, 5, 6], km_min: 1 }, usages: [] },
  { code: "traceur_muet", actif: true, gravite: "critique", parametres: { heures: 48 }, usages: [] },
  { code: "arret_prolonge", actif: true, gravite: "attention", parametres: { minutes: 120, rayon_m: 300, depot_lat: 5.2927, depot_lng: -3.9463 }, usages: ["livraison"] },
  { code: "sortie_zone", actif: true, gravite: "critique", parametres: { centre_lat: 5.345, centre_lng: -4.024, rayon_km: 45 }, usages: [] },
  { code: "km_journalier", actif: true, gravite: "attention", parametres: { seuil_km: 300, ecart_pct: 150 }, usages: [] },
  { code: "moteur_ralenti", actif: false, gravite: "info", parametres: { minutes: 20 }, usages: [] },
];
const seg = (o: Partial<Parameters<typeof evaluateGpsRules>[0]["segments"][number]>) => ({
  vehicleId: "c",
  type: "trajet" as const,
  debut: "2026-11-10T09:00:00Z",
  dureeS: 600,
  distanceKm: 5,
  vitesseMax: 50,
  latitude: 5.33,
  longitude: -4.0,
  latitudeFin: 5.33,
  longitudeFin: -4.0,
  ralentiS: 0,
  ...o,
});

test("plage de travail : lundi-samedi 6 h - 20 h, dimanche hors heures", () => {
  const p = rules[1].parametres;
  assert.equal(inWorkHours("2026-11-10T09:00:00Z", p), true); // mardi
  assert.equal(inWorkHours("2026-11-10T21:30:00Z", p), false);
  assert.equal(inWorkHours("2026-11-08T10:00:00Z", p), false); // dimanche
});

test("alertes : vitesse (seuil moto), hors heures, traceur muet, arrêt loin des lieux connus, sortie de zone", () => {
  const ev = evaluateGpsRules({
    rules,
    vehicles: [
      { id: "c", libelle: "Camion", type: "camion", usage: "livraison" },
      { id: "m", libelle: "Moto", type: "moto", usage: "commercial" },
    ],
    positions: [{ vehicleId: "m", latitude: 5.29, longitude: -3.96, vitesse: 0, moteur: null, signalLe: "2026-11-07T08:00:00Z", arretDepuisS: 0 }],
    segments: [
      seg({ vitesseMax: 95 }),
      seg({ vehicleId: "m", vitesseMax: 75, debut: "2026-11-10T10:00:00Z" }),
      seg({ debut: "2026-11-09T22:00:00Z", distanceKm: 12 }),
      seg({ debut: "2026-11-10T11:00:00Z", type: "arret", dureeS: 3 * 3600, latitude: 5.4, longitude: -4.1 }),
      seg({ debut: "2026-11-10T14:00:00Z", type: "arret", dureeS: 3 * 3600, latitude: 5.2928, longitude: -3.9464 }),
      seg({ debut: "2026-11-10T15:00:00Z", latitudeFin: 5.84, longitudeFin: -4.0 }),
      seg({ vehicleId: "m", debut: "2026-11-10T16:00:00Z", type: "arret", dureeS: 5 * 3600, latitude: 5.5, longitude: -4.2 }),
    ],
    days: [],
    knownPlaces: [],
    now: "2026-11-10T18:00:00Z",
  });
  const codes = ev.map((e) => `${e.ruleCode}:${e.vehicleId}`).sort();
  assert.deepEqual(codes, [
    "arret_prolonge:c", // l'arrêt au dépôt n'en est pas un ; la moto (commercial) n'est pas concernée
    "exces_vitesse:c",
    "exces_vitesse:m", // 75 km/h > 70 pour une moto
    "hors_heures:c",
    "sortie_zone:c",
    "traceur_muet:m",
  ]);
  assert.equal(new Set(ev.map((e) => e.dedupeKey)).size, ev.length);
});

test("km journalier : seuil absolu ou très au-dessus de l'habitude, journée terminée seulement", () => {
  const days = [
    ...["01", "02", "03", "04", "05", "06"].map((d) => ({ vehicleId: "c", jour: `2026-11-${d}`, km: 60 })),
    { vehicleId: "c", jour: "2026-11-07", km: 200 },
    { vehicleId: "c", jour: "2026-11-08", km: 320 },
    { vehicleId: "c", jour: "2026-11-10", km: 400 },
  ];
  const ev = evaluateGpsRules({ rules, vehicles: [{ id: "c", libelle: "C", type: "camion", usage: null }], positions: [], segments: [], days, knownPlaces: [], now: "2026-11-10T12:00:00Z" });
  assert.deepEqual(ev.map((e) => e.dedupeKey), ["km_journalier:c:2026-11-07", "km_journalier:c:2026-11-08"]);
});

test("rapprochement : km GPS entre deux pleins, position à l'heure du ticket et station la plus proche", () => {
  const stations = [
    { nom: "Total Riviera", lat: 5.36, lng: -3.96 },
    { nom: "Shell Yopougon", lat: 5.33, lng: -4.07 },
  ];
  const r = fuelGpsCheck(
    {
      datePlein: "2026-11-10T10:05:00Z",
      datePleinPrecedent: "2026-11-08T08:00:00Z",
      segments: [
        { type: "trajet", debut: "2026-11-08T09:00:00Z", fin: "2026-11-08T10:00:00Z", distanceKm: 120.4, latitude: null, longitude: null, latitudeFin: null, longitudeFin: null },
        { type: "trajet", debut: "2026-11-09T09:00:00Z", fin: "2026-11-09T10:00:00Z", distanceKm: 80, latitude: null, longitude: null, latitudeFin: null, longitudeFin: null },
        { type: "arret", debut: "2026-11-10T10:00:00Z", fin: "2026-11-10T10:20:00Z", distanceKm: 0, latitude: 5.3301, longitude: -4.0702, latitudeFin: null, longitudeFin: null },
        { type: "trajet", debut: "2026-11-10T11:00:00Z", fin: null, distanceKm: 9, latitude: null, longitude: null, latitudeFin: null, longitudeFin: null },
      ],
      station: null,
      stations,
    },
    distanceM
  );
  assert.equal(r.gpsKm, 200.4);
  assert.equal(r.stationNom, "Shell Yopougon");
  assert.ok(r.distanceStationM! < 100);

  const a = analyzeFuelFills(
    [
      { id: "1", datePlein: "2026-11-08T08:00:00Z", litres: 40, montant: 30000, km: 10000 },
      { id: "2", datePlein: "2026-11-10T10:05:00Z", litres: 40, montant: 30000, km: 10300, gpsKm: 200.4, distanceStationM: 2500, stationNom: "Total Riviera" },
    ],
    { energie: null, reservoirLitres: null },
    [],
    { ecartConsommationPct: 25, ecartPrixPct: 10, ecartKmGpsPct: 15, distanceStationMaxM: 500 }
  );
  assert.deepEqual(a[1].anomalies.map((x) => x.code), ["km_gps", "hors_station"]);
});

console.log(`\n${n} test(s) OK`);
