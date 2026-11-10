import "server-only";
import { parseDevices, parseHistory, historyRange, type FreetrackDevice, type FreetrackSegment } from "./freetrack-parse";

/**
 * Client FreeTrack (API GPSWOX), côté serveur seulement, en LECTURE SEULE :
 * connexion, liste des traceurs, historique (trajets et arrêts). Les
 * identifiants viennent du Vault (freetrack_credentials, clé de service).
 */

export class FreetrackError extends Error {
  constructor(
    message: string,
    readonly sessionExpired = false
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

async function call(baseUrl: string, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<unknown> {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const init: RequestInit = { method, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new FreetrackError(`FreeTrack injoignable (${e instanceof Error ? e.message : "réseau"}).`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FreetrackError(`Réponse illisible de FreeTrack (HTTP ${res.status}).`);
  }
  if (json && typeof json === "object" && !Array.isArray(json) && (json as Record<string, unknown>).status === 0) {
    const msg = String((json as Record<string, unknown>).message ?? "Échec");
    throw new FreetrackError(`FreeTrack : ${msg}`, /connexion|login|auth/i.test(msg) || res.status === 401);
  }
  if (res.status === 401 || res.status === 403) throw new FreetrackError("FreeTrack : session refusée.", true);
  if (!res.ok) throw new FreetrackError(`FreeTrack : erreur HTTP ${res.status}.`);
  return json;
}

export async function freetrackLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const json = (await call(baseUrl, "api/login", { email, password }, "POST")) as Record<string, unknown>;
  const hash = typeof json?.user_api_hash === "string" ? json.user_api_hash : null;
  if (!hash) throw new FreetrackError("FreeTrack : identifiants refusés.");
  return hash;
}

export async function freetrackDevices(baseUrl: string, hash: string): Promise<FreetrackDevice[]> {
  return parseDevices(await call(baseUrl, "api/get_devices", { user_api_hash: hash, lang: "fr" }));
}

export async function freetrackHistory(baseUrl: string, hash: string, deviceId: number, from: Date, to: Date): Promise<FreetrackSegment[]> {
  return parseHistory(
    await call(baseUrl, "api/get_history", { user_api_hash: hash, lang: "fr", device_id: String(deviceId), ...historyRange(from, to) })
  );
}
