import "server-only";
import { supabaseStorageProvider } from "@/lib/storage/providers/supabase-storage";
import { googleDriveProvider } from "@/lib/storage/providers/google-drive";
import { webdavProvider } from "@/lib/storage/providers/webdav";
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
