import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadFromTarget, isWebdavTarget, removeFromTarget, uploadToTarget } from "@/lib/storage";
import type { StorageTargetRow } from "@/lib/storage/types";

/**
 * Fichiers DXF du module Patronnage. `traces_placement.fichier_path` accepte
 * deux formats, sans migration :
 *  - historique : chemin dans le bucket Supabase "patronnage" ;
 *  - NAS : "target:<id de storage_targets>:<chemin WebDAV complet>".
 * Les nouveaux dépôts vont sur le NAS dès qu'une cible NAS/serveur local est
 * active ; les anciens fichiers restent lisibles là où ils sont.
 */
const LEGACY_BUCKET = "patronnage";
const NAS_PREFIX = "target:";

async function loadTarget(id: string): Promise<StorageTargetRow> {
  const { data } = await createAdminClient().from("storage_targets").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("Cible de stockage introuvable");
  return data as StorageTargetRow;
}

async function activeNasTarget(): Promise<StorageTargetRow | null> {
  const { data } = await createAdminClient()
    .from("storage_targets")
    .select("*")
    .eq("active", true)
    .in("type", ["nas", "local_server"])
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  const target = (data?.[0] as StorageTargetRow | undefined) ?? null;
  return target && isWebdavTarget(target) ? target : null;
}

function parseNasPath(path: string): { targetId: string; remotePath: string } | null {
  if (!path.startsWith(NAS_PREFIX)) return null;
  const rest = path.slice(NAS_PREFIX.length);
  const i = rest.indexOf(":");
  return i < 0 ? null : { targetId: rest.slice(0, i), remotePath: rest.slice(i + 1) };
}

/** Enregistre un DXF et renvoie la valeur à mettre dans `fichier_path`. */
export async function storeTraceFile(relativePath: string, buffer: Buffer): Promise<{ path: string } | { error: string }> {
  const nas = await activeNasTarget();
  if (nas) {
    try {
      const { remotePath } = await uploadToTarget(nas, {
        companyId: "",
        companyName: "",
        fileName: relativePath.split("/").pop() ?? relativePath,
        mimeType: "application/dxf",
        buffer,
        relativePath: `Patronnage/${relativePath}`,
      });
      return { path: `${NAS_PREFIX}${nas.id}:${remotePath}` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "NAS injoignable" };
    }
  }

  const { error } = await createAdminClient()
    .storage.from(LEGACY_BUCKET)
    .upload(relativePath, buffer, { contentType: "application/dxf", upsert: false });
  return error ? { error: error.message } : { path: relativePath };
}

export async function readTraceFile(path: string): Promise<Buffer | null> {
  try {
    const nas = parseNasPath(path);
    if (nas) return await downloadFromTarget(await loadTarget(nas.targetId), nas.remotePath);
    const { data, error } = await createAdminClient().storage.from(LEGACY_BUCKET).download(path);
    return error || !data ? null : Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** Suppression au mieux : un fichier orphelin ne doit jamais bloquer l'action métier. */
export async function removeTraceFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      const nas = parseNasPath(path);
      if (nas) await removeFromTarget(await loadTarget(nas.targetId), nas.remotePath);
      else await createAdminClient().storage.from(LEGACY_BUCKET).remove([path]);
    } catch {
      // ignoré volontairement (voir doc)
    }
  }
}
