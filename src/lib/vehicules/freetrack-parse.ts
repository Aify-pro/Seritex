/**
 * Lecture des réponses de l'API FreeTrack (GPSWOX), sans réseau ni base :
 * testée par scripts/test-vehicules-gps.ts.
 *
 * GPSWOX renvoie des dates « JJ-MM-AAAA HH:MM:SS » à l'heure du compte
 * (Abidjan = UTC), des distances « 73.88 Km » et des segments d'historique
 * numérotés : 1 = trajet, 2 = arrêt, 3 = début, 4 = fin.
 */

export interface FreetrackDevice {
  deviceId: number;
  nom: string;
  latitude: number;
  longitude: number;
  vitesse: number;
  cap: number | null;
  moteur: boolean | null;
  etat: string;
  adresse: string | null;
  signalLe: string | null;
  arretDepuisS: number | null;
  odometreKm: number | null;
}

export interface FreetrackSegment {
  type: "trajet" | "arret";
  debut: string;
  fin: string | null;
  dureeS: number | null;
  distanceKm: number;
  vitesseMax: number | null;
  vitesseMoy: number | null;
  latitude: number | null;
  longitude: number | null;
  latitudeFin: number | null;
  longitudeFin: number | null;
  ralentiS: number | null;
}

/** « 10-11-2026 07:33:51 » → ISO UTC ; null si illisible. */
export function parseGpswoxDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}Z`;
  return null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/[^\d.-]/g, ""));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Immatriculation comparable : « 2632JP01* », « AA-638-AL*(MOTO) » → « 2632JP01 », « AA638AL ». */
export function normalizePlate(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** Moto d'après le nom du traceur (« … (MOTO) »). */
export function looksLikeMoto(name: string): boolean {
  return /\bMOTO\b/i.test(name);
}

function sensor(item: Record<string, unknown>, type: string): string | null {
  const list = Array.isArray(item.sensors) ? (item.sensors as Record<string, unknown>[]) : [];
  const s = list.find((x) => x.type === type);
  return s && typeof s.value === "string" ? s.value : null;
}

/** get_devices : liste de groupes { items: [...] } → traceurs à plat. */
export function parseDevices(json: unknown): FreetrackDevice[] {
  if (!Array.isArray(json)) return [];
  const out: FreetrackDevice[] = [];
  for (const group of json as Record<string, unknown>[]) {
    const items = Array.isArray(group?.items) ? (group.items as Record<string, unknown>[]) : [];
    for (const it of items) {
      const id = num(it.id);
      const lat = num(it.lat);
      const lng = num(it.lng);
      if (id === null || lat === null || lng === null) continue;
      const ts = num(it.timestamp);
      const moteurTxt = sensor(it, "engine");
      const odo = sensor(it, "odometer");
      const adresse = typeof it.address === "string" && it.address.trim() && it.address !== "-" ? it.address.trim() : null;
      out.push({
        deviceId: id,
        nom: String(it.name ?? `Traceur ${id}`),
        latitude: lat,
        longitude: lng,
        vitesse: Math.max(0, Math.round(num(it.speed) ?? 0)),
        cap: num(it.course),
        moteur: moteurTxt === null || moteurTxt === "-" ? null : /^on$/i.test(moteurTxt),
        etat: String(it.online ?? "inconnu"),
        adresse,
        signalLe: ts ? new Date(ts * 1000).toISOString() : parseGpswoxDate(it.time),
        arretDepuisS: num(it.stop_duration_sec),
        odometreKm: odo ? num(odo) : null,
      });
    }
  }
  return out;
}

/** get_history : segments trajet (1) et arrêt (2) ; début (3) et fin (4) ignorés. */
export function parseHistory(json: unknown): FreetrackSegment[] {
  const items = json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).items)
    ? ((json as Record<string, unknown>).items as Record<string, unknown>[])
    : [];
  const out: FreetrackSegment[] = [];
  for (const s of items) {
    const status = num(s.status);
    if (status !== 1 && status !== 2) continue;
    const debut = parseGpswoxDate(s.show);
    if (!debut) continue;
    const points = Array.isArray(s.items) ? (s.items as Record<string, unknown>[]) : [];
    const first = points[0];
    const last = points[points.length - 1];
    out.push({
      type: status === 1 ? "trajet" : "arret",
      debut,
      fin: parseGpswoxDate(s.left),
      dureeS: num(s.time_seconds),
      distanceKm: Math.max(0, num(s.distance) ?? 0),
      vitesseMax: num(s.top_speed),
      vitesseMoy: num(s.average_speed),
      latitude: first ? num(first.lat ?? first.latitude) : null,
      longitude: first ? num(first.lng ?? first.longitude) : null,
      latitudeFin: last ? num(last.lat ?? last.latitude) : null,
      longitudeFin: last ? num(last.lng ?? last.longitude) : null,
      ralentiS: num(s.engine_idle),
    });
  }
  return out;
}

/** Distance en mètres entre deux points (formule de haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Paramètres de date d'un appel get_history (heure du compte = UTC). */
export function historyRange(from: Date, to: Date) {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const t = (x: Date) => x.toISOString().slice(11, 16);
  return { from_date: d(from), from_time: t(from), to_date: d(to), to_time: t(to) };
}
