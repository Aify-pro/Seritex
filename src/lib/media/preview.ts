import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseStorageSignedUrl } from "@/lib/storage/providers/supabase-storage";

/**
 * Résolution "media_file_id → copie Supabase Storage exploitable" pour la
 * prévisualisation (maquette, écran ODF) et l'intégration au PDF. Ne
 * connaît que Supabase Storage : c'est la seule cible réellement active en
 * exploitation (storage_targets, seed 0003) — un fichier répliqué
 * uniquement vers Google Drive/NAS n'a aujourd'hui aucun aperçu, plutôt que
 * de prétendre le supporter sans l'avoir implémenté.
 *
 * `remote_path` est enregistré au format "bucket/chemin" (voir
 * supabaseStorageProvider.upload) — le premier segment est retiré ici pour
 * obtenir le chemin réel dans le bucket.
 */
async function resolveSupabaseCopies(mediaFileIds: string[]) {
  const result = new Map<string, { bucket: string; path: string; mimeType: string | null }>();
  if (mediaFileIds.length === 0) return result;

  const supabase = await createClient();

  const { data: files } = await supabase
    .from("media_files")
    .select("id, current_version_id, mime_type")
    .in("id", mediaFileIds);

  const versionIds = (files ?? [])
    .map((f) => f.current_version_id)
    .filter((v): v is string => !!v);
  if (versionIds.length === 0) return result;

  const { data: copies } = await supabase
    .from("media_file_copies")
    .select("media_file_version_id, remote_path, storage_targets(type)")
    .in("media_file_version_id", versionIds)
    .eq("sync_status", "synchronise");

  for (const file of files ?? []) {
    if (!file.current_version_id) continue;
    const copy = (copies ?? []).find((c) => {
      const target = c.storage_targets as unknown as { type: string } | null;
      return c.media_file_version_id === file.current_version_id && target?.type === "supabase_storage" && !!c.remote_path;
    });
    if (!copy?.remote_path) continue;

    const [bucket, ...rest] = copy.remote_path.split("/");
    if (!bucket || rest.length === 0) continue;
    result.set(file.id, { bucket, path: rest.join("/"), mimeType: file.mime_type });
  }

  return result;
}

/**
 * URLs signées (1h) pour affichage navigateur — clé = media_file_id. Un
 * fichier sans copie Supabase Storage synchronisée est simplement absent du
 * résultat (aucune tentative d'aperçu côté écran dans ce cas).
 */
export async function getMediaFilePreviewUrls(mediaFileIds: string[]): Promise<Map<string, string>> {
  const resolved = await resolveSupabaseCopies(mediaFileIds);
  const result = new Map<string, string>();

  await Promise.all(
    Array.from(resolved.entries()).map(async ([id, copy]) => {
      const url = await getSupabaseStorageSignedUrl(copy.bucket, copy.path);
      if (url) result.set(id, url);
    })
  );

  return result;
}

/**
 * Octets bruts + type MIME — pdf-lib ne peut pas consommer une URL, il lui
 * faut le contenu du fichier. Passe par le client admin (bucket privé, même
 * mécanique que le téléchargement d'un tracé Patronnage, voir
 * fiches-actions.ts).
 */
export async function getMediaFileBuffers(
  mediaFileIds: string[]
): Promise<Map<string, { buffer: Buffer; mimeType: string | null }>> {
  const resolved = await resolveSupabaseCopies(mediaFileIds);
  const result = new Map<string, { buffer: Buffer; mimeType: string | null }>();
  if (resolved.size === 0) return result;

  const admin = createAdminClient();
  await Promise.all(
    Array.from(resolved.entries()).map(async ([id, copy]) => {
      const { data, error } = await admin.storage.from(copy.bucket).download(copy.path);
      if (error || !data) return;
      const arrayBuffer = await data.arrayBuffer();
      result.set(id, { buffer: Buffer.from(arrayBuffer), mimeType: copy.mimeType });
    })
  );

  return result;
}
