import "server-only";
import { supabaseStorageProvider } from "@/lib/storage/providers/supabase-storage";
import { googleDriveProvider } from "@/lib/storage/providers/google-drive";
import { webdavProvider } from "@/lib/storage/providers/webdav";
import { StorageProviderError } from "@/lib/storage/types";
import type { StorageProvider, StorageTargetRow, UploadInput, UploadResult } from "@/lib/storage/types";

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
