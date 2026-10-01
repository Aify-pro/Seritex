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

  async download(_target: StorageTargetRow, remotePath: string): Promise<Buffer> {
    const [bucket, ...rest] = remotePath.split("/");
    const { data, error } = await createAdminClient().storage.from(bucket).download(rest.join("/"));
    if (error || !data) {
      throw new StorageProviderError("supabase_storage", `Lecture Supabase Storage impossible : ${error?.message ?? "fichier introuvable"}`, error);
    }
    return Buffer.from(await data.arrayBuffer());
  },

  async remove(_target: StorageTargetRow, remotePath: string): Promise<void> {
    const [bucket, ...rest] = remotePath.split("/");
    await createAdminClient().storage.from(bucket).remove([rest.join("/")]);
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
