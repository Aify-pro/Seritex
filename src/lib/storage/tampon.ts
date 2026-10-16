import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadFromTarget, removeFromTarget, replicateToTargets, selectWriteTargets } from "@/lib/storage";
import type { StorageTargetRow } from "@/lib/storage/types";

export interface ViderTamponResult {
  /** Fichiers déplacés du tampon vers le stockage. */
  deplaces: number;
  /** Fichiers restés dans le tampon (stockage injoignable ou erreur). */
  restants: number;
  message?: string;
}

const LOT = 20;

type TamponRow = {
  id: string;
  media_file_version_id: string;
  storage_target_id: string;
  remote_path: string;
  media_file_versions: {
    file_name: string;
    mime_type: string | null;
    media_files: { company_id: string; companies: { name: string } | null } | null;
  } | null;
};

/**
 * Déplace les fichiers en attente dans les cibles « tampon » vers le(s)
 * stockage(s) actif(s). Pour chaque fichier : lecture dans le tampon, écriture
 * sur chaque stockage qui n'a pas déjà sa copie, puis — seulement si tous ont
 * réussi — suppression du fichier et de la copie du tampon. Au premier échec
 * (NAS toujours injoignable) on s'arrête : le reste attendra le prochain passage.
 * Utilise le client d'administration : appelé sans session (planificateur).
 */
export async function viderTampon(): Promise<ViderTamponResult> {
  const admin = createAdminClient();
  const { data: actives } = await admin.from("storage_targets").select("*").eq("active", true);
  const targets = (actives ?? []) as StorageTargetRow[];
  const buffers = targets.filter((t) => t.role === "tampon");
  const principal = selectWriteTargets(targets);
  if (buffers.length === 0) return { deplaces: 0, restants: 0 };

  // Les tampons désactivés peuvent encore contenir des fichiers : on les vide aussi.
  const { data: allBuffers } = await admin.from("storage_targets").select("*").eq("role", "tampon");
  const bufferById = new Map(((allBuffers ?? []) as StorageTargetRow[]).map((t) => [t.id, t]));

  const { data: rows } = await admin
    .from("media_file_copies")
    .select(
      "id, media_file_version_id, storage_target_id, remote_path, media_file_versions(file_name, mime_type, media_files(company_id, companies(name)))"
    )
    .in("storage_target_id", Array.from(bufferById.keys()))
    .eq("sync_status", "en_attente")
    .not("remote_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(LOT);
  const pending = (rows ?? []) as unknown as TamponRow[];
  if (pending.length === 0) return { deplaces: 0, restants: 0 };
  if (principal.length === 0) {
    return { deplaces: 0, restants: pending.length, message: "Aucun stockage actif : les fichiers restent dans le tampon." };
  }

  let deplaces = 0;
  let message: string | undefined;

  for (const row of pending) {
    const bufferTarget = bufferById.get(row.storage_target_id);
    const version = row.media_file_versions;
    if (!bufferTarget || !version) continue;

    const { data: existing } = await admin
      .from("media_file_copies")
      .select("storage_target_id, sync_status")
      .eq("media_file_version_id", row.media_file_version_id);
    const done = new Set((existing ?? []).filter((c) => c.sync_status === "synchronise").map((c) => c.storage_target_id));
    const missing = principal.filter((t) => !done.has(t.id));

    if (missing.length > 0) {
      let buffer: Buffer;
      try {
        buffer = await downloadFromTarget(bufferTarget, row.remote_path);
      } catch (error) {
        message = `Lecture du tampon « ${bufferTarget.name} » impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`;
        continue;
      }
      const outcomes = await replicateToTargets(missing, {
        companyId: version.media_files?.company_id ?? "",
        companyName: version.media_files?.companies?.name ?? "Client",
        fileName: version.file_name,
        mimeType: version.mime_type,
        buffer,
      });

      const now = new Date().toISOString();
      await admin.from("media_file_copies").upsert(
        outcomes.map((o) => ({
          media_file_version_id: row.media_file_version_id,
          storage_target_id: o.targetId,
          remote_path: o.remotePath ?? null,
          sync_status: o.status === "synchronise" ? "synchronise" : "en_attente",
          error_message: o.errorMessage ?? null,
          synced_at: o.status === "synchronise" ? now : null,
        })),
        { onConflict: "media_file_version_id,storage_target_id" }
      );

      const failed = outcomes.find((o) => o.status !== "synchronise");
      if (failed) {
        message = failed.errorMessage ?? "Stockage injoignable";
        break;
      }
    }

    // Tout est sur le stockage : le tampon peut être libéré.
    try {
      await removeFromTarget(bufferTarget, row.remote_path);
    } catch (error) {
      message = `Fichier copié mais non supprimé du tampon « ${bufferTarget.name} » : ${error instanceof Error ? error.message : "erreur inconnue"}`;
      continue;
    }
    await admin.from("media_file_copies").delete().eq("id", row.id);
    deplaces += 1;
  }

  return { deplaces, restants: pending.length - deplaces, message };
}
