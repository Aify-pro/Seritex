import "server-only";
import { StorageProviderError } from "@/lib/storage/types";
import type { StorageBackendType } from "@/lib/storage/types";

/**
 * Exécute une étape d'un test de connexion : en cas d'échec, l'erreur est
 * relevée en StorageProviderError dont le message est le NOM de l'étape (« Accès
 * au dossier racine ») et la cause l'erreur d'origine — describeError() en tire
 * ensuite une explication lisible et un détail technique.
 */
export async function atStep<T>(type: StorageBackendType, step: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StorageProviderError) throw error;
    throw new StorageProviderError(type, step, error);
  }
}

type Anyish = {
  name?: string;
  message?: string;
  code?: string | number;
  status?: number;
  statusText?: string;
  response?: { status?: number; statusText?: string };
  cause?: unknown;
};

function asObject(e: unknown): Anyish {
  return e && typeof e === "object" ? (e as Anyish) : { message: String(e) };
}

/** Premier code réseau / statut HTTP trouvé dans l'erreur ou ses causes imbriquées. */
function findCodes(e: unknown): { code?: string; status?: number } {
  let cur: unknown = e;
  const out: { code?: string; status?: number } = {};
  for (let i = 0; i < 4 && cur; i++) {
    const o = asObject(cur);
    const numericCode = typeof o.code === "number" ? o.code : typeof o.code === "string" && /^\d{3}$/.test(o.code) ? Number(o.code) : undefined;
    out.status ??= o.status ?? o.response?.status ?? numericCode;
    if (typeof o.code === "string" && !/^\d{3}$/.test(o.code)) out.code ??= o.code;
    cur = o.cause;
  }
  return out;
}

function rawMessage(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const o = asObject(cur);
    const m = [o.name && o.name !== "Error" ? o.name : null, o.message].filter(Boolean).join(": ");
    if (m && !parts.includes(m)) parts.push(m);
    cur = o.cause;
  }
  return parts.join(" ← ");
}

/** Explication en français des causes les plus courantes. */
function explain(e: unknown): string {
  const { code, status } = findCodes(e);
  const msg = rawMessage(e);
  if (status === 401) return "Identifiants refusés (401) : identifiant ou mot de passe incorrect.";
  if (status === 403) return "Accès interdit (403) : le compte n'a pas le droit d'accéder à cette ressource.";
  if (status === 404) return "Ressource introuvable (404) : URL, dossier ou identifiant incorrect.";
  if (status === 405 || status === 501) return `Le serveur répond mais n'accepte pas WebDAV sur cette URL (${status}).`;
  if (status && status >= 500) return `Le serveur a répondu par une erreur interne (${status}).`;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Adresse introuvable (DNS) : le nom d'hôte n'existe pas ou n'est pas résolu depuis Internet.";
    case "ECONNREFUSED":
      return "Connexion refusée : le service est arrêté ou le port est fermé.";
    case "ECONNRESET":
    case "EPIPE":
      return "Connexion coupée par le serveur (ECONNRESET) : pare-feu, proxy ou mauvais protocole (http/https).";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return "Serveur injoignable (délai dépassé) : NAS éteint, pare-feu, ou non accessible depuis Internet — Vercel n'est pas sur votre réseau local.";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `Certificat HTTPS invalide (${code}) : expiré, auto-signé ou au mauvais nom.`;
  }
  if (/invalid_grant/i.test(msg)) return "Clé du compte de service rejetée (invalid_grant) : clé révoquée ou supprimée.";
  if (/DECODER|PEM|private key/i.test(msg)) return "Clé privée du compte de service illisible : JSON tronqué ou modifié.";
  if (/Unexpected token|JSON/i.test(msg)) return "Le JSON du compte de service est invalide.";
  if (/Invalid URL/i.test(msg)) return "URL invalide : elle doit commencer par http:// ou https://.";
  if (/fetch failed/i.test(msg)) return "Échec de la requête réseau : serveur injoignable.";
  return "Erreur inattendue (voir le détail technique).";
}

/** Retire les secrets (mot de passe, clés) de tout texte affiché. */
export function scrub(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("••••");
  return out.replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "••••");
}

/**
 * Message lisible + détail technique d'une erreur de test de connexion.
 * `message` = « étape — explication » ; `detail` = code, statut et messages bruts
 * (chaîne de causes), secrets masqués.
 */
export function describeError(error: unknown, secrets: (string | undefined)[] = []): { message: string; detail: string } {
  const step = error instanceof StorageProviderError && error.cause !== undefined ? error.message : null;
  const origin = error instanceof StorageProviderError && error.cause !== undefined ? error.cause : error;
  const { code, status } = findCodes(origin);
  const friendly = origin instanceof StorageProviderError ? origin.message : explain(origin);
  const message = step ? `${step} — ${friendly}` : friendly;
  const detail = [status ? `statut HTTP ${status}` : null, code ? `code ${code}` : null, rawMessage(origin)]
    .filter(Boolean)
    .join(" · ");
  return { message: scrub(message, secrets), detail: scrub(detail, secrets) };
}
