import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StorageProvider, StorageTargetRow, UploadInput, UploadResult } from "@/lib/storage/types";
import { StorageProviderError } from "@/lib/storage/types";

/**
 * Cible de stockage active par défaut (aucune configuration externe requise).
 * Utilise le bucket privé Supabase Storage désigné dans `target.config.bucket`
 * (créé manuellement dans le dashboard Supabase, cf. esquisse d'avancement).
 * L'accès en lecture se fait ensuite via URL signée, jamais en public.
 */
export const supabaseStorageProvider: StorageProvider = {
  async upload(target: StorageTargetRow, input: UploadInput): Promise<UploadResult> {
    const bucket = (target.config as { bucket?: string })?.bucket;
    if (!bucket) {
      throw new StorageProviderError("supabase_storage", "Bucket Supabase Storage non configuré pour cette cible");
    }

    const admin = createAdminClient();
    const remotePath = `${input.companyId}/${Date.now()}-${sanitizeFileName(input.fileName)}`;

    const { error } = await admin.storage.from(bucket).upload(remotePath, input.buffer, {
      contentType: input.mimeType ?? undefined,
      upsert: false,
    });

    if (error) {
      throw new StorageProviderError("supabase_storage", `Échec de l'upload Supabase Storage : ${error.message}`, error);
    }

    return { remotePath: `${bucket}/${remotePath}` };
  },
};

export async function getSupabaseStorageSignedUrl(bucket: string, remotePath: string, expiresInSeconds = 3600) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(remotePath, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}
