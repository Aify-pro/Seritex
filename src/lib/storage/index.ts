import "server-only";
import { supabaseStorageProvider } from "@/lib/storage/providers/supabase-storage";
import { googleDriveProvider } from "@/lib/storage/providers/google-drive";
import { webdavProvider } from "@/lib/storage/providers/webdav";
import { StorageProviderError } from "@/lib/storage/types";
import { describeError } from "@/lib/storage/diagnostics";
import type { ConnectionStatus, StorageProvider, StorageTargetRow, UploadInput, UploadResult } from "@/lib/storage/types";

export type { StorageTargetRow, UploadInput, UploadResult, StorageBackendType } from "@/lib/storage/types";
export { StorageProviderError } from "@/lib/storage/types";

const PROVIDERS: Record<StorageTargetRow["type"], StorageProvider> = {
  supabase_storage: supabaseStorageProvider,
  google_drive: googleDriveProvider,
  nas: webdavProvider,
  local_server: webdavProvider,
};

/**
 * Point d'entrée unique de la couche de stockage : copie un fichier vers UNE
 * cible donnée et renvoie le chemin distant à enregistrer dans
 * `media_file_copies` (section 3.7). Chaque cible active choisie pour un
 * dépôt est traitée séparément par l'appelant, en tolérant l'échec d'une
 * cible sans bloquer les autres (cf. `replicateToTargets`).
 */
export async function uploadToTarget(target: StorageTargetRow, input: UploadInput): Promise<UploadResult> {
  const provider = PROVIDERS[target.type];
  return provider.upload(target, input);
}

export interface ReplicationOutcome {
  targetId: string;
  status: "synchronise" | "erreur" | "en_attente";
  remotePath?: string;
  errorMessage?: string;
}

/**
 * Réplique un fichier vers plusieurs cibles en parallèle. L'échec d'une
 * cible (ex. NAS injoignable) n'empêche pas les autres de réussir — chaque
 * résultat individuel est destiné à être écrit dans `media_file_copies`
 * (sync_status = 'synchronise' | 'erreur') par l'appelant.
 */
export async function replicateToTargets(
  targets: StorageTargetRow[],
  input: UploadInput,
  timeoutMs = UPLOAD_TIMEOUT_MS
): Promise<ReplicationOutcome[]> {
  return Promise.all(
    targets.map(async (target): Promise<ReplicationOutcome> => {
      try {
        const result = await withTimeout(uploadToTarget(target, input), timeoutMs, `${target.name} : aucune réponse en ${Math.round(timeoutMs / 1000)} s`);
        return { targetId: target.id, status: "synchronise", remotePath: result.remotePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inconnue";
        return { targetId: target.id, status: "erreur", errorMessage: message };
      }
    })
  );
}

// Un NAS éteint ne répond pas : sans borne, le dépôt resterait suspendu jusqu'à l'expiration de la fonction.
const UPLOAD_TIMEOUT_MS = 40_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isWebdavTarget(target: Pick<StorageTargetRow, "type">) {
  return target.type === "nas" || target.type === "local_server";
}

/**
 * Cibles réellement utilisées pour ÉCRIRE : dès qu'un NAS/serveur local est
 * actif, il devient le stockage exclusif et Supabase Storage n'est plus
 * alimenté. Sans NAS actif, on garde le comportement historique.
 */
export function selectWriteTargets(activeTargets: StorageTargetRow[]): StorageTargetRow[] {
  const principal = activeTargets.filter((t) => t.role !== "tampon");
  return principal.some(isWebdavTarget) ? principal.filter((t) => t.type !== "supabase_storage") : principal;
}

/** Cibles « tampon » actives, dans l'ordre de création : relais quand aucun stockage n'est joignable. */
export function selectBufferTargets(activeTargets: StorageTargetRow[]): StorageTargetRow[] {
  return activeTargets
    .filter((t) => t.role === "tampon")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Enregistre un fichier : sur les cibles de stockage actives ; si AUCUNE n'a
 * pu l'enregistrer (NAS injoignable), sur la première cible tampon qui répond.
 * Le fichier est alors « en_attente » : `viderTampon` (lib/storage/tampon.ts)
 * le déplacera vers le stockage dès qu'il sera de nouveau joignable.
 */
export async function replicateWithBuffer(
  activeTargets: StorageTargetRow[],
  input: UploadInput
): Promise<{ outcomes: ReplicationOutcome[]; buffered: boolean }> {
  const principal = selectWriteTargets(activeTargets);
  const outcomes = await replicateToTargets(principal, input);
  const stored = outcomes.some((o) => o.status === "synchronise");
  const buffers = selectBufferTargets(activeTargets);
  if (stored || buffers.length === 0) return { outcomes, buffered: false };

  for (const buffer of buffers) {
    const [outcome] = await replicateToTargets([buffer], input);
    if (outcome.status !== "synchronise") {
      outcomes.push(outcome);
      continue;
    }
    // Le stockage n'a pas reçu le fichier : ses lignes passent « en attente » (erreur conservée), le tampon porte le fichier.
    return {
      outcomes: [
        ...outcomes.map((o): ReplicationOutcome => ({ ...o, status: "en_attente" })),
        { ...outcome, status: "en_attente" },
      ],
      buffered: true,
    };
  }
  return { outcomes, buffered: false };
}

const CHECK_TIMEOUT_MS = 12_000;

/** Valeurs secrètes d'une cible, à masquer dans tout message de diagnostic. */
function secretsOf(target: StorageTargetRow): string[] {
  const c = target.config as { password?: string; serviceAccountJson?: string };
  const out = [c.password, c.serviceAccountJson];
  try {
    const parsed = JSON.parse(c.serviceAccountJson ?? "{}") as { private_key?: string; private_key_id?: string };
    out.push(parsed.private_key, parsed.private_key_id);
  } catch {
    // JSON invalide : rien d'autre à masquer
  }
  return out.filter((s): s is string => !!s);
}

/**
 * Teste la connexion à une cible (jamais d'exception : le résultat dit
 * « connecté » ou « non connecté » avec la cause). Borné à 12 s : un NAS éteint
 * ne doit pas figer la page. `deep` ajoute l'écriture d'un fichier témoin.
 */
export async function checkTargetConnection(target: StorageTargetRow, options: { deep?: boolean } = {}): Promise<ConnectionStatus> {
  const started = Date.now();
  const base = () => ({ checkedAt: new Date().toISOString(), durationMs: Date.now() - started });
  const provider = PROVIDERS[target.type];
  if (!provider.check) {
    return { ...base(), connected: false, message: "Ce type de cible ne peut pas être testé." };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.check(target, { deep: options.deep }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StorageProviderError(target.type, "Délai dépassé", Object.assign(new Error(`aucune réponse en ${CHECK_TIMEOUT_MS / 1000} s`), { code: "ETIMEDOUT" }))), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { ...base(), connected: true, warning: result.warning, checks: result.checks };
  } catch (error) {
    const { message, detail } = describeError(error, secretsOf(target));
    return { ...base(), connected: false, message, detail };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function downloadFromTarget(target: StorageTargetRow, remotePath: string): Promise<Buffer> {
  const provider = PROVIDERS[target.type];
  if (!provider.download) {
    throw new StorageProviderError(target.type, "La lecture n'est pas prise en charge pour ce type de stockage");
  }
  return provider.download(target, remotePath);
}

export async function removeFromTarget(target: StorageTargetRow, remotePath: string): Promise<void> {
  await PROVIDERS[target.type].remove?.(target, remotePath);
}
