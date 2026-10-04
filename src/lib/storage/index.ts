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
  status: "synchronise" | "erreur";
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
  input: UploadInput
): Promise<ReplicationOutcome[]> {
  return Promise.all(
    targets.map(async (target): Promise<ReplicationOutcome> => {
      try {
        const result = await uploadToTarget(target, input);
        return { targetId: target.id, status: "synchronise", remotePath: result.remotePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inconnue";
        return { targetId: target.id, status: "erreur", errorMessage: message };
      }
    })
  );
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
  return activeTargets.some(isWebdavTarget)
    ? activeTargets.filter((t) => t.type !== "supabase_storage")
    : activeTargets;
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
