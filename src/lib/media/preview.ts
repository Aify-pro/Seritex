import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseStorageSignedUrl } from "@/lib/storage/providers/supabase-storage";
import { downloadFromTarget, isWebdavTarget } from "@/lib/storage";
import type { StorageTargetRow } from "@/lib/storage/types";

type ResolvedCopy =
  | { kind: "supabase"; bucket: string; path: string; mimeType: string | null }
  | { kind: "webdav"; target: StorageTargetRow; remotePath: string; mimeType: string | null };

/**
 * Résolution "media_file_id → copie exploitable" pour la prévisualisation
 * (maquette, écran ODF), l'intégration au PDF et le téléchargement. On prend
 * la copie synchronisée de la version courante, en préférant le NAS (stockage
 * principal) à Supabase Storage (anciens fichiers). Un fichier dont la seule
 * copie est sur Google Drive n'a aucun aperçu (lecture non implémentée).
 *
 * Pour Supabase, `remote_path` est au format "bucket/chemin" (voir
 * supabaseStorageProvider.upload) — le premier segment est retiré ici pour
 * obtenir le chemin réel dans le bucket.
 */
async function resolveCopies(mediaFileIds: string[]) {
  const result = new Map<string, ResolvedCopy>();
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
    .select("media_file_version_id, remote_path, storage_target_id, storage_targets(type)")
    .in("media_file_version_id", versionIds)
    .eq("sync_status", "synchronise");

  // La configuration (identifiants WebDAV) n'est lisible que par un
  // administrateur : on la lit côté serveur, jamais renvoyée au navigateur.
  const webdavTargetIds = Array.from(
    new Set(
      (copies ?? [])
        .filter((c) => isWebdavTarget({ type: (c.storage_targets as unknown as { type: StorageTargetRow["type"] } | null)?.type ?? "supabase_storage" }))
        .map((c) => c.storage_target_id)
    )
  );
  const targetsById = new Map<string, StorageTargetRow>();
  if (webdavTargetIds.length > 0) {
    const { data: targets } = await createAdminClient().from("storage_targets").select("*").in("id", webdavTargetIds);
    for (const t of (targets ?? []) as StorageTargetRow[]) targetsById.set(t.id, t);
  }

  for (const file of files ?? []) {
    if (!file.current_version_id) continue;
    const versionCopies = (copies ?? []).filter(
      (c) => c.media_file_version_id === file.current_version_id && !!c.remote_path
    );

    const nasCopy = versionCopies.find((c) => targetsById.has(c.storage_target_id));
    if (nasCopy?.remote_path) {
      result.set(file.id, {
        kind: "webdav",
        target: targetsById.get(nasCopy.storage_target_id)!,
        remotePath: nasCopy.remote_path,
        mimeType: file.mime_type,
      });
      continue;
    }

    const supabaseCopy = versionCopies.find(
      (c) => (c.storage_targets as unknown as { type: string } | null)?.type === "supabase_storage"
    );
    if (!supabaseCopy?.remote_path) continue;
    const [bucket, ...rest] = supabaseCopy.remote_path.split("/");
    if (!bucket || rest.length === 0) continue;
    result.set(file.id, { kind: "supabase", bucket, path: rest.join("/"), mimeType: file.mime_type });
  }

  return result;
}

/**
 * URLs pour affichage navigateur — clé = media_file_id. Supabase : URL signée
 * (1h). NAS : route applicative authentifiée qui relaie le fichier (le NAS et
 * ses identifiants ne sont jamais exposés au navigateur). Un fichier sans
 * copie exploitable est simplement absent du résultat.
 */
export async function getMediaFilePreviewUrls(mediaFileIds: string[]): Promise<Map<string, string>> {
  const resolved = await resolveCopies(mediaFileIds);
  const result = new Map<string, string>();

  await Promise.all(
    Array.from(resolved.entries()).map(async ([id, copy]) => {
      if (copy.kind === "webdav") {
        result.set(id, `/api/media/${id}/file`);
        return;
      }
      const url = await getSupabaseStorageSignedUrl(copy.bucket, copy.path);
      if (url) result.set(id, url);
    })
  );

  return result;
}

/**
 * Octets bruts + type MIME — pdf-lib ne peut pas consommer une URL, il lui
 * faut le contenu du fichier. Passe par le serveur (bucket privé / NAS, même
 * mécanique que le téléchargement d'un tracé Patronnage, voir
 * lib/storage/patronnage-files.ts).
 */
export async function getMediaFileBuffers(
  mediaFileIds: string[]
): Promise<Map<string, { buffer: Buffer; mimeType: string | null }>> {
  const resolved = await resolveCopies(mediaFileIds);
  const result = new Map<string, { buffer: Buffer; mimeType: string | null }>();
  if (resolved.size === 0) return result;

  const admin = createAdminClient();
  await Promise.all(
    Array.from(resolved.entries()).map(async ([id, copy]) => {
      try {
        if (copy.kind === "webdav") {
          result.set(id, { buffer: await downloadFromTarget(copy.target, copy.remotePath), mimeType: copy.mimeType });
          return;
        }
        const { data, error } = await admin.storage.from(copy.bucket).download(copy.path);
        if (error || !data) return;
        result.set(id, { buffer: Buffer.from(await data.arrayBuffer()), mimeType: copy.mimeType });
      } catch {
        // NAS injoignable : le fichier est simplement absent du PDF/aperçu.
      }
    })
  );

  return result;
}

/** Contenu d'un fichier pour la route de téléchargement (null si introuvable ou illisible). */
export async function getMediaFileContent(mediaFileId: string): Promise<{ buffer: Buffer; mimeType: string | null } | null> {
  return (await getMediaFileBuffers([mediaFileId])).get(mediaFileId) ?? null;
}
