import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { FreetrackError, freetrackDevices, freetrackHistory, freetrackLogin } from "./freetrack";
import { distanceM, type FreetrackDevice } from "./freetrack-parse";
import { evaluateGpsRules, type AlertRule } from "./gps-alerts";
import { fuelGpsCheck } from "./calculs";

/**
 * Synchronisation FreeTrack (VEH-5, 8, 9), exécutée avec la clé de service :
 *   1. connexion (session en cache, renouvelée si refusée) ;
 *   2. positions de tous les traceurs ; celles des véhicules reliés sont
 *      enregistrées ;
 *   3. trajets et arrêts depuis le dernier segment connu de chaque véhicule ;
 *   4. évaluation des règles d'alerte (une alerte par situation) ;
 *   5. rapprochement GPS des pleins justifiés pas encore vérifiés ;
 *   6. état de la synchronisation (heure, erreur, nombre de traceurs).
 * Lecture seule côté FreeTrack : aucune écriture vers la plateforme.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface SyncResult {
  ok: boolean;
  skipped?: string;
  traceurs?: number;
  vehiculesRelies?: number;
  segments?: number;
  alertes?: number;
  pleinsVerifies?: number;
  erreur?: string;
}

interface Credentials {
  base_url: string;
  email: string | null;
  password: string | null;
  actif: boolean;
  frequence_minutes: number;
  derniere_synchro_at: string | null;
}

async function credentials(admin: Admin): Promise<Credentials | null> {
  const { data, error } = await admin.rpc("freetrack_credentials");
  if (error) throw new FreetrackError(`Lecture des identifiants impossible : ${error.message}`);
  return ((data ?? []) as Credentials[])[0] ?? null;
}

/** Clé de session : celle en cache, sinon une nouvelle connexion. */
async function session(admin: Admin, c: Credentials, renew = false): Promise<string> {
  if (!renew) {
    const { data } = await admin.from("freetrack_session").select("api_hash").eq("id", true).maybeSingle();
    if (data?.api_hash) return data.api_hash as string;
  }
  if (!c.email || !c.password) throw new FreetrackError("Identifiants FreeTrack incomplets (Paramètres > Logistique > Géolocalisation).");
  const hash = await freetrackLogin(c.base_url, c.email, c.password);
  await admin.from("freetrack_session").upsert({ id: true, api_hash: hash, obtenue_le: new Date().toISOString() });
  return hash;
}

/** Appel avec renouvellement automatique d'une session expirée. */
async function withSession<T>(admin: Admin, c: Credentials, fn: (hash: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await session(admin, c));
  } catch (e) {
    if (e instanceof FreetrackError && e.sessionExpired) return fn(await session(admin, c, true));
    throw e;
  }
}

/** Test depuis Paramètres : connexion et liste des traceurs (rien n'est enregistré, sauf la session). */
export async function testFreetrackConnection(): Promise<{ devices: FreetrackDevice[] }> {
  const admin = createAdminClient();
  const c = await credentials(admin);
  if (!c) throw new FreetrackError("Réglages FreeTrack introuvables.");
  const devices = await withSession(admin, c, (h) => freetrackDevices(c.base_url, h));
  await admin.from("freetrack_settings").update({ traceurs_trouves: devices.length, derniere_erreur: null }).eq("id", true);
  return { devices };
}

export async function runFreetrackSync(options: { force?: boolean } = {}): Promise<SyncResult> {
  const admin = createAdminClient();
  const c = await credentials(admin);
  if (!c || !c.actif) return { ok: true, skipped: "Synchronisation désactivée." };
  if (!c.email || !c.password) return { ok: true, skipped: "Identifiants incomplets." };
  if (!options.force && c.derniere_synchro_at) {
    const minutes = (Date.now() - Date.parse(c.derniere_synchro_at)) / 60_000;
    if (minutes < c.frequence_minutes - 1) return { ok: true, skipped: `Prochaine synchronisation dans ${Math.ceil(c.frequence_minutes - minutes)} min.` };
  }

  const startedAt = new Date();
  try {
    const result = await sync(admin, c, startedAt);
    await admin
      .from("freetrack_settings")
      .update({ derniere_synchro_at: startedAt.toISOString(), derniere_synchro_ok: true, derniere_erreur: null, traceurs_trouves: result.traceurs })
      .eq("id", true);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    await admin
      .from("freetrack_settings")
      .update({ derniere_synchro_at: startedAt.toISOString(), derniere_synchro_ok: false, derniere_erreur: message.slice(0, 500) })
      .eq("id", true);
    return { ok: false, erreur: message };
  }
}

async function sync(admin: Admin, c: Credentials, now: Date): Promise<SyncResult> {
  // 1-2. Positions.
  const devices = await withSession(admin, c, (h) => freetrackDevices(c.base_url, h));
  const { data: vehicles } = await admin.from("vehicles").select("id,libelle,type,usage,freetrack_device_id").not("freetrack_device_id", "is", null);
  const linked = ((vehicles ?? []) as { id: string; libelle: string; type: string; usage: string | null; freetrack_device_id: number }[]).filter((v) =>
    devices.some((d) => d.deviceId === v.freetrack_device_id)
  );
  if (linked.length > 0) {
    const rows = linked.map((v) => {
      const d = devices.find((x) => x.deviceId === v.freetrack_device_id)!;
      return {
        vehicle_id: v.id,
        device_id: d.deviceId,
        latitude: d.latitude,
        longitude: d.longitude,
        vitesse: d.vitesse,
        cap: d.cap,
        moteur: d.moteur,
        etat_traceur: d.etat,
        adresse: d.adresse,
        signal_le: d.signalLe,
        arret_depuis_s: d.arretDepuisS,
        odometre_traceur_km: d.odometreKm,
        synchro_le: now.toISOString(),
      };
    });
    const { error } = await admin.from("vehicle_positions").upsert(rows, { onConflict: "vehicle_id" });
    if (error) throw new Error(`Positions non enregistrées : ${error.message}`);
  }

  // 3. Trajets et arrêts, depuis le début du dernier segment connu (le segment
  // en cours est remis à jour) ; première fois : les 3 derniers jours. Budget
  // de 35 s : ce qui n'est pas rapatrié l'est au passage suivant (le curseur
  // est le dernier segment enregistré).
  let segmentsCount = 0;
  const budgetEnd = now.getTime() + 35_000;
  for (const v of linked) {
    if (Date.now() > budgetEnd) break;
    const { data: last } = await admin
      .from("vehicle_gps_segments")
      .select("debut")
      .eq("vehicle_id", v.id)
      .order("debut", { ascending: false })
      .limit(1)
      .maybeSingle();
    const from = last?.debut ? new Date(Date.parse(last.debut as string) - 60_000) : new Date(now.getTime() - 3 * 86_400_000);
    // GPSWOX limite la taille d'un historique : on avance par tranches de 24 h.
    for (let start = from; start < now && Date.now() <= budgetEnd; start = new Date(start.getTime() + 86_400_000)) {
      const end = new Date(Math.min(start.getTime() + 86_400_000, now.getTime()));
      const segs = await withSession(admin, c, (h) => freetrackHistory(c.base_url, h, v.freetrack_device_id, start, end));
      if (segs.length === 0) continue;
      const { error } = await admin.from("vehicle_gps_segments").upsert(
        segs.map((s) => ({
          vehicle_id: v.id,
          type: s.type,
          debut: s.debut,
          fin: s.fin,
          duree_s: s.dureeS,
          distance_km: Math.round(s.distanceKm * 100) / 100,
          vitesse_max: s.vitesseMax,
          vitesse_moy: s.vitesseMoy,
          latitude: s.latitude,
          longitude: s.longitude,
          latitude_fin: s.latitudeFin,
          longitude_fin: s.longitudeFin,
          ralenti_s: s.ralentiS,
          synchro_le: now.toISOString(),
        })),
        { onConflict: "vehicle_id,type,debut" }
      );
      if (error) throw new Error(`Trajets non enregistrés : ${error.message}`);
      segmentsCount += segs.length;
    }
  }

  const alertes = await raiseAlerts(admin, linked, now);
  const pleinsVerifies = await checkFuelVouchers(admin, linked.map((v) => v.id));

  // Purge : trajets et arrêts de plus de 13 mois.
  await admin.from("vehicle_gps_segments").delete().lt("debut", new Date(now.getTime() - 400 * 86_400_000).toISOString());

  return { ok: true, traceurs: devices.length, vehiculesRelies: linked.length, segments: segmentsCount, alertes, pleinsVerifies };
}

async function raiseAlerts(admin: Admin, linked: { id: string; libelle: string; type: string; usage: string | null }[], now: Date): Promise<number> {
  if (linked.length === 0) return 0;
  const since = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const ids = linked.map((v) => v.id);
  const [{ data: rules }, { data: positions }, { data: segments }, { data: days }, { data: places }, { data: stations }] = await Promise.all([
    admin.from("vehicle_alert_rules").select("code,actif,gravite,parametres,usages"),
    admin.from("vehicle_positions").select("vehicle_id,latitude,longitude,vitesse,moteur,signal_le,arret_depuis_s").in("vehicle_id", ids),
    admin
      .from("vehicle_gps_segments")
      .select("vehicle_id,type,debut,duree_s,distance_km,vitesse_max,latitude,longitude,latitude_fin,longitude_fin,ralenti_s")
      .in("vehicle_id", ids)
      .gte("debut", since),
    admin.from("vehicle_gps_days").select("vehicle_id,jour,km").in("vehicle_id", ids).gte("jour", new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10)),
    admin.from("delivery_places").select("latitude,longitude").not("latitude", "is", null),
    admin.from("fuel_stations").select("latitude,longitude").eq("actif", true).not("latitude", "is", null),
  ]);
  const events = evaluateGpsRules({
    rules: (rules ?? []) as AlertRule[],
    vehicles: linked,
    positions: ((positions ?? []) as Record<string, unknown>[]).map((p) => ({
      vehicleId: p.vehicle_id as string,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      vitesse: Number(p.vitesse),
      moteur: p.moteur as boolean | null,
      signalLe: p.signal_le as string | null,
      arretDepuisS: p.arret_depuis_s as number | null,
    })),
    segments: ((segments ?? []) as Record<string, unknown>[]).map((s) => ({
      vehicleId: s.vehicle_id as string,
      type: s.type as "trajet" | "arret",
      debut: new Date(s.debut as string).toISOString(),
      dureeS: s.duree_s as number | null,
      distanceKm: Number(s.distance_km),
      vitesseMax: s.vitesse_max as number | null,
      latitude: s.latitude as number | null,
      longitude: s.longitude as number | null,
      latitudeFin: s.latitude_fin as number | null,
      longitudeFin: s.longitude_fin as number | null,
      ralentiS: s.ralenti_s as number | null,
    })),
    days: ((days ?? []) as { vehicle_id: string; jour: string; km: number | null }[]).map((d) => ({ vehicleId: d.vehicle_id, jour: d.jour, km: Number(d.km ?? 0) })),
    knownPlaces: [...((places ?? []) as { latitude: number; longitude: number }[]), ...((stations ?? []) as { latitude: number; longitude: number }[])].map((p) => ({
      lat: Number(p.latitude),
      lng: Number(p.longitude),
    })),
    now: now.toISOString(),
  });
  if (events.length === 0) return 0;
  const { data, error } = await admin
    .from("vehicle_alert_events")
    .upsert(
      events.map((e) => ({
        rule_code: e.ruleCode,
        vehicle_id: e.vehicleId,
        survenue_le: e.survenueLe,
        valeur: e.valeur,
        message: e.message.slice(0, 500),
        latitude: e.latitude,
        longitude: e.longitude,
        dedupe_key: e.dedupeKey,
      })),
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(`Alertes non enregistrées : ${error.message}`);
  return (data ?? []).length;
}

/** Rapprochement des pleins justifiés depuis plus d'une heure (le temps que FreeTrack ait les trajets). */
export async function checkFuelVouchers(admin: Admin, vehicleIds: string[]): Promise<number> {
  if (vehicleIds.length === 0) return 0;
  const { data: pending } = await admin
    .from("fuel_vouchers")
    .select("id,vehicle_id,date_plein,station_id")
    .eq("statut", "justifie")
    .is("gps_verifie_le", null)
    .in("vehicle_id", vehicleIds)
    .lt("date_plein", new Date(Date.now() - 3_600_000).toISOString())
    .gte("date_plein", new Date(Date.now() - 400 * 86_400_000).toISOString())
    .limit(50);
  const rows = (pending ?? []) as { id: string; vehicle_id: string; date_plein: string; station_id: string | null }[];
  if (rows.length === 0) return 0;
  const { data: stationRows } = await admin.from("fuel_stations").select("id,nom,latitude,longitude").not("latitude", "is", null);
  const stations = ((stationRows ?? []) as { id: string; nom: string; latitude: number; longitude: number }[]).map((s) => ({
    id: s.id,
    nom: s.nom,
    lat: Number(s.latitude),
    lng: Number(s.longitude),
  }));
  let done = 0;
  for (const b of rows) {
    const { data: prev } = await admin
      .from("fuel_vouchers")
      .select("date_plein")
      .eq("vehicle_id", b.vehicle_id)
      .eq("statut", "justifie")
      .lt("date_plein", b.date_plein)
      .order("date_plein", { ascending: false })
      .limit(1)
      .maybeSingle();
    const from = (prev?.date_plein as string | undefined) ?? new Date(Date.parse(b.date_plein) - 86_400_000).toISOString();
    const { data: segs } = await admin
      .from("vehicle_gps_segments")
      .select("type,debut,fin,distance_km,latitude,longitude,latitude_fin,longitude_fin")
      .eq("vehicle_id", b.vehicle_id)
      .gte("debut", new Date(Date.parse(from) - 86_400_000).toISOString())
      .lte("debut", new Date(Date.parse(b.date_plein) + 3_600_000).toISOString());
    const segments = ((segs ?? []) as Record<string, unknown>[]).map((s) => ({
      type: s.type as "trajet" | "arret",
      debut: new Date(s.debut as string).toISOString(),
      fin: s.fin ? new Date(s.fin as string).toISOString() : null,
      distanceKm: Number(s.distance_km),
      latitude: s.latitude as number | null,
      longitude: s.longitude as number | null,
      latitudeFin: s.latitude_fin as number | null,
      longitudeFin: s.longitude_fin as number | null,
    }));
    if (segments.length === 0) continue; // pas encore de trajets : on réessaiera
    const station = b.station_id ? (stations.find((s) => s.id === b.station_id) ?? null) : null;
    const r = fuelGpsCheck(
      { datePlein: new Date(b.date_plein).toISOString(), datePleinPrecedent: prev?.date_plein ? new Date(prev.date_plein as string).toISOString() : null, segments, station, stations },
      distanceM
    );
    await admin
      .from("fuel_vouchers")
      .update({
        gps_km: r.gpsKm,
        gps_distance_station_m: r.distanceStationM,
        gps_station_nom: r.stationNom,
        gps_note: r.note,
        gps_verifie_le: new Date().toISOString(),
      })
      .eq("id", b.id);
    done += 1;
  }
  return done;
}
