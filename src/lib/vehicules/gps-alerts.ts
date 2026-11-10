/**
 * Évaluation des règles d'alerte GPS (VEH-8), sans base ni réseau : testée
 * par scripts/test-vehicules-gps.ts. Entrées : les règles (Paramètres), les
 * véhicules reliés, leurs dernières positions, leurs trajets et arrêts récents
 * et leurs km par jour. Sortie : les alertes à enregistrer ; la clé de
 * dédoublonnage garantit qu'une même situation ne lève qu'une alerte.
 * Heure d'Abidjan = UTC.
 */
import { distanceM } from "./freetrack-parse";

export interface AlertRule {
  code: string;
  actif: boolean;
  gravite: string;
  parametres: Record<string, unknown>;
  usages: string[];
}

export interface GpsVehicle {
  id: string;
  libelle: string;
  type: string;
  usage: string | null;
}

export interface GpsPosition {
  vehicleId: string;
  latitude: number;
  longitude: number;
  vitesse: number;
  moteur: boolean | null;
  signalLe: string | null;
  arretDepuisS: number | null;
}

export interface GpsSegment {
  vehicleId: string;
  type: "trajet" | "arret";
  debut: string;
  dureeS: number | null;
  distanceKm: number;
  vitesseMax: number | null;
  latitude: number | null;
  longitude: number | null;
  latitudeFin: number | null;
  longitudeFin: number | null;
  ralentiS: number | null;
}

export interface GpsDay {
  vehicleId: string;
  jour: string;
  km: number;
}

export interface AlertEvent {
  ruleCode: string;
  vehicleId: string;
  survenueLe: string;
  valeur: number | null;
  message: string;
  latitude: number | null;
  longitude: number | null;
  dedupeKey: string;
}

const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const hhmm = (iso: string) => iso.slice(11, 16).replace(":", " h ");
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtKm = (km: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(km)} km`;

/** La plage de travail (règle « hors heures ») sert aussi à « arrêt prolongé ». */
export function inWorkHours(iso: string, p: Record<string, unknown>): boolean {
  const d = new Date(iso);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const jours = Array.isArray(p.jours) ? (p.jours as number[]) : [1, 2, 3, 4, 5, 6];
  if (!jours.includes(isoDay)) return false;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const toMin = (s: unknown, def: number): number => {
    const m = String(s ?? "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : def;
  };
  return minutes >= toMin(p.debut, 6 * 60) && minutes < toMin(p.fin, 20 * 60);
}

export function evaluateGpsRules(input: {
  rules: AlertRule[];
  vehicles: GpsVehicle[];
  positions: GpsPosition[];
  segments: GpsSegment[];
  days: GpsDay[];
  knownPlaces: { lat: number; lng: number }[];
  now: string;
}): AlertEvent[] {
  const { vehicles, positions, segments, days, knownPlaces, now } = input;
  const rule = (code: string) => input.rules.find((r) => r.code === code && r.actif);
  const concerned = (r: AlertRule, v: GpsVehicle) => r.usages.length === 0 || (v.usage !== null && r.usages.includes(v.usage));
  const workRule = input.rules.find((r) => r.code === "hors_heures");
  const workParams = workRule?.parametres ?? {};
  const events: AlertEvent[] = [];
  const today = now.slice(0, 10);

  for (const v of vehicles) {
    const segs = segments.filter((s) => s.vehicleId === v.id);
    const pos = positions.find((p) => p.vehicleId === v.id);

    const vitesse = rule("exces_vitesse");
    if (vitesse && concerned(vitesse, v)) {
      const limite = v.type === "moto" ? n(vitesse.parametres.seuil_moto_kmh, 70) : n(vitesse.parametres.seuil_kmh, 90);
      for (const s of segs) {
        if (s.type !== "trajet" || s.vitesseMax === null || s.vitesseMax <= limite) continue;
        events.push({
          ruleCode: "exces_vitesse",
          vehicleId: v.id,
          survenueLe: s.debut,
          valeur: s.vitesseMax,
          message: `Pointe à ${s.vitesseMax} km/h (limite ${limite}) sur un trajet de ${fmtKm(s.distanceKm)} le ${dateFr(s.debut)} à ${hhmm(s.debut)}.`,
          latitude: s.latitude,
          longitude: s.longitude,
          dedupeKey: `exces_vitesse:${v.id}:${s.debut}`,
        });
      }
    }

    const horaires = rule("hors_heures");
    if (horaires && concerned(horaires, v)) {
      const kmMin = n(horaires.parametres.km_min, 1);
      for (const s of segs) {
        if (s.type !== "trajet" || s.distanceKm < kmMin || inWorkHours(s.debut, horaires.parametres)) continue;
        const jour = JOURS[new Date(s.debut).getUTCDay()];
        events.push({
          ruleCode: "hors_heures",
          vehicleId: v.id,
          survenueLe: s.debut,
          valeur: s.distanceKm,
          message: `Trajet de ${fmtKm(s.distanceKm)} le ${jour} ${dateFr(s.debut)} à ${hhmm(s.debut)}, hors heures de travail.`,
          latitude: s.latitude,
          longitude: s.longitude,
          dedupeKey: `hors_heures:${v.id}:${s.debut}`,
        });
      }
    }

    const muet = rule("traceur_muet");
    if (muet && concerned(muet, v) && pos?.signalLe) {
      const heures = (Date.parse(now) - Date.parse(pos.signalLe)) / 3_600_000;
      const seuil = n(muet.parametres.heures, 48);
      if (heures >= seuil) {
        events.push({
          ruleCode: "traceur_muet",
          vehicleId: v.id,
          survenueLe: pos.signalLe,
          valeur: Math.round(heures),
          message: `Aucun signal du traceur depuis ${Math.round(heures)} h (dernier signal le ${dateFr(pos.signalLe)} à ${hhmm(pos.signalLe)}).`,
          latitude: pos.latitude,
          longitude: pos.longitude,
          dedupeKey: `traceur_muet:${v.id}:${pos.signalLe}`,
        });
      }
    }

    const arret = rule("arret_prolonge");
    if (arret && concerned(arret, v)) {
      const minutes = n(arret.parametres.minutes, 120);
      const rayon = n(arret.parametres.rayon_m, 300);
      const depot =
        typeof arret.parametres.depot_lat === "number" && typeof arret.parametres.depot_lng === "number"
          ? [{ lat: arret.parametres.depot_lat as number, lng: arret.parametres.depot_lng as number }]
          : [];
      const places = [...depot, ...knownPlaces];
      for (const s of segs) {
        if (s.type !== "arret" || s.latitude === null || s.longitude === null || (s.dureeS ?? 0) < minutes * 60) continue;
        if (!inWorkHours(s.debut, workParams)) continue;
        const here = { lat: s.latitude, lng: s.longitude };
        if (places.some((p) => distanceM(here, p) <= rayon)) continue;
        const duree = Math.round((s.dureeS ?? 0) / 60);
        events.push({
          ruleCode: "arret_prolonge",
          vehicleId: v.id,
          survenueLe: s.debut,
          valeur: duree,
          message: `Arrêt de ${duree >= 120 ? `${Math.floor(duree / 60)} h ${String(duree % 60).padStart(2, "0")}` : `${duree} min`} le ${dateFr(s.debut)} à partir de ${hhmm(s.debut)}, loin des lieux connus.`,
          latitude: s.latitude,
          longitude: s.longitude,
          dedupeKey: `arret_prolonge:${v.id}:${s.debut}`,
        });
      }
    }

    const zone = rule("sortie_zone");
    if (zone && concerned(zone, v)) {
      const centre = { lat: n(zone.parametres.centre_lat, 5.345), lng: n(zone.parametres.centre_lng, -4.024) };
      const rayonKm = n(zone.parametres.rayon_km, 45);
      const points = [
        ...segs
          .filter((s) => s.type === "trajet" && s.latitudeFin !== null && s.longitudeFin !== null)
          .map((s) => ({ at: s.debut, lat: s.latitudeFin as number, lng: s.longitudeFin as number })),
        ...(pos && pos.signalLe ? [{ at: pos.signalLe, lat: pos.latitude, lng: pos.longitude }] : []),
      ];
      const far = points
        .map((p) => ({ ...p, km: distanceM(p, centre) / 1000 }))
        .filter((p) => p.km > rayonKm)
        .sort((a, b) => b.km - a.km);
      // Une alerte par jour au plus : le point le plus éloigné.
      const byDay = new Map<string, (typeof far)[number]>();
      for (const p of far) if (!byDay.has(p.at.slice(0, 10))) byDay.set(p.at.slice(0, 10), p);
      for (const [jour, p] of byDay) {
        events.push({
          ruleCode: "sortie_zone",
          vehicleId: v.id,
          survenueLe: p.at,
          valeur: Math.round(p.km),
          message: `Véhicule à ${Math.round(p.km)} km du centre de la zone (limite ${rayonKm} km) le ${dateFr(p.at)}.`,
          latitude: p.lat,
          longitude: p.lng,
          dedupeKey: `sortie_zone:${v.id}:${jour}`,
        });
      }
    }

    const kmRule = rule("km_journalier");
    if (kmRule && concerned(kmRule, v)) {
      const seuil = n(kmRule.parametres.seuil_km, 300);
      const ecart = n(kmRule.parametres.ecart_pct, 150);
      const own = days.filter((d) => d.vehicleId === v.id).sort((a, b) => a.jour.localeCompare(b.jour));
      for (const d of own) {
        if (d.jour >= today) continue; // journée terminée seulement
        const avant = own.filter((x) => x.jour < d.jour && x.km > 0).slice(-14);
        const moyenne = avant.length >= 5 ? avant.reduce((s, x) => s + x.km, 0) / avant.length : null;
        const auDessusSeuil = d.km > seuil;
        const auDessusHabitude = moyenne !== null && moyenne > 0 && d.km > moyenne * (1 + ecart / 100);
        if (!auDessusSeuil && !auDessusHabitude) continue;
        events.push({
          ruleCode: "km_journalier",
          vehicleId: v.id,
          survenueLe: `${d.jour}T23:59:00Z`,
          valeur: Math.round(d.km),
          message: auDessusSeuil
            ? `${fmtKm(d.km)} parcourus le ${dateFr(d.jour)} (seuil ${seuil} km).`
            : `${fmtKm(d.km)} parcourus le ${dateFr(d.jour)}, pour une habitude de ${fmtKm(moyenne as number)} par jour.`,
          latitude: null,
          longitude: null,
          dedupeKey: `km_journalier:${v.id}:${d.jour}`,
        });
      }
    }

    const ralenti = rule("moteur_ralenti");
    if (ralenti && concerned(ralenti, v)) {
      const minutes = n(ralenti.parametres.minutes, 20);
      for (const s of segs) {
        if (s.type !== "arret" || (s.ralentiS ?? 0) < minutes * 60) continue;
        events.push({
          ruleCode: "moteur_ralenti",
          vehicleId: v.id,
          survenueLe: s.debut,
          valeur: Math.round((s.ralentiS ?? 0) / 60),
          message: `Moteur au ralenti ${Math.round((s.ralentiS ?? 0) / 60)} min à l'arrêt le ${dateFr(s.debut)} à ${hhmm(s.debut)}.`,
          latitude: s.latitude,
          longitude: s.longitude,
          dedupeKey: `moteur_ralenti:${v.id}:${s.debut}`,
        });
      }
      if (pos && pos.moteur === true && pos.vitesse === 0 && (pos.arretDepuisS ?? 0) >= minutes * 60) {
        const depuis = new Date(Date.parse(now) - (pos.arretDepuisS ?? 0) * 1000).toISOString().slice(0, 16);
        events.push({
          ruleCode: "moteur_ralenti",
          vehicleId: v.id,
          survenueLe: `${depuis}:00Z`,
          valeur: Math.round((pos.arretDepuisS ?? 0) / 60),
          message: `Moteur allumé à l'arrêt depuis ${Math.round((pos.arretDepuisS ?? 0) / 60)} min.`,
          latitude: pos.latitude,
          longitude: pos.longitude,
          dedupeKey: `moteur_ralenti:${v.id}:en_cours:${depuis.slice(0, 13)}`,
        });
      }
    }
  }
  return events;
}
