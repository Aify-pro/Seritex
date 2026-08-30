"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, requireRole } from "@/lib/auth/current-user";
import { replicateToTargets } from "@/lib/storage";
import type { StorageTargetRow } from "@/lib/storage/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 Mo — cohérent avec une limite raisonnable pour un visuel/fiche technique

const uploadSchema = z.object({
  company_id: z.string().uuid(),
  category: z.enum(["visuel", "image_de_marque", "fiche_technique", "nuancier", "autre"]),
  reason: z.string().trim().min(4, "La raison doit contenir au moins 4 caractères"),
});

/**
 * Dépose un nouveau fichier dans la médiathèque d'un client. La réplication
 * se fait automatiquement vers toutes les cibles de stockage actives
 * (section 3.7) — l'utilisateur qui dépose un fichier n'a pas à choisir un
 * support, Supabase Storage restant toujours actif par défaut.
 */
export async function uploadMediaFile(formData: FormData) {
  const { profile } = await requireUser();

  const parsed = uploadSchema.safeParse({
    company_id: formData.get("company_id") || profile.company_id,
    category: formData.get("category") || "autre",
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (profile.role === "client" && parsed.data.company_id !== profile.company_id) {
    return { error: "Accès refusé" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Merci de sélectionner un fichier" };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { error: "Fichier trop volumineux (25 Mo maximum)" };
  }

  const supabase = await createClient();

  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", parsed.data.company_id)
    .single();

  const { data: versionId, error: rpcError } = await supabase.rpc("add_media_file", {
    p_company_id: parsed.data.company_id,
    p_file_name: file.name,
    p_category: parsed.data.category,
    p_mime_type: file.type || null,
    p_size_bytes: file.size,
    p_reason: parsed.data.reason,
  });

  if (rpcError) return { error: rpcError.message };

  const { data: mediaFile } = await supabase
    .from("media_files")
    .select("id")
    .eq("current_version_id", versionId)
    .single();

  if (!mediaFile) return { error: "Le fichier a été créé mais n'a pas pu être retrouvé pour la réplication" };

  const buffer = Buffer.from(await file.arrayBuffer());
  await replicateVersion({
    versionId,
    companyId: parsed.data.company_id,
    companyName: company?.name ?? "Client",
    fileName: file.name,
    mimeType: file.type || null,
    buffer,
  });

  revalidatePath(`/mediatheque/${parsed.data.company_id}`);
  return { mediaFileId: mediaFile.id };
}

const versionSchema = z.object({
  media_file_id: z.string().uuid(),
  reason: z.string().trim().min(4, "La raison doit contenir au moins 4 caractères"),
});

/** Ajoute une nouvelle version (mise à jour) d'un fichier existant — raison obligatoire, l'historique est conservé. */
export async function addMediaFileVersion(formData: FormData) {
  await requireUser();

  const parsed = versionSchema.safeParse({
    media_file_id: formData.get("media_file_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Merci de sélectionner un fichier" };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { error: "Fichier trop volumineux (25 Mo maximum)" };
  }

  const supabase = await createClient();

  const { data: mediaFile } = await supabase
    .from("media_files")
    .select("id, company_id, companies(name)")
    .eq("id", parsed.data.media_file_id)
    .single();

  if (!mediaFile) return { error: "Fichier introuvable" };

  const { data: versionId, error: rpcError } = await supabase.rpc("add_media_file_version", {
    p_media_file_id: parsed.data.media_file_id,
    p_file_name: file.name,
    p_mime_type: file.type || null,
    p_size_bytes: file.size,
    p_reason: parsed.data.reason,
  });

  if (rpcError) return { error: rpcError.message };

  const buffer = Buffer.from(await file.arrayBuffer());
  const companyName = (mediaFile.companies as unknown as { name: string } | null)?.name ?? "Client";
  await replicateVersion({
    versionId,
    companyId: mediaFile.company_id,
    companyName,
    fileName: file.name,
    mimeType: file.type || null,
    buffer,
  });

  revalidatePath(`/mediatheque/${mediaFile.company_id}`);
  return { mediaFileId: mediaFile.id };
}

/**
 * Réplique une version fraîchement créée vers toutes les cibles de stockage
 * actives, puis enregistre le résultat (succès ou erreur) de chaque cible
 * dans `media_file_copies`. Utilise le client "service_role" uniquement pour
 * lire la liste des cibles (dont les identifiants ne doivent jamais être
 * exposés à un rôle non-administrateur, y compris via une requête cliente
 * involontaire) — l'écriture des copies repasse par le client authentifié de
 * l'utilisateur, soumis aux policies RLS habituelles.
 */
async function replicateVersion(params: {
  versionId: string;
  companyId: string;
  companyName: string;
  fileName: string;
  mimeType: string | null;
  buffer: Buffer;
}) {
  const admin = createAdminClient();
  const { data: targets } = await admin
    .from("storage_targets")
    .select("*")
    .eq("active", true);

  if (!targets || targets.length === 0) return;

  const outcomes = await replicateToTargets(targets as StorageTargetRow[], {
    companyId: params.companyId,
    companyName: params.companyName,
    fileName: params.fileName,
    mimeType: params.mimeType,
    buffer: params.buffer,
  });

  const supabase = await createClient();
  await supabase.from("media_file_copies").insert(
    outcomes.map((outcome) => ({
      media_file_version_id: params.versionId,
      storage_target_id: outcome.targetId,
      remote_path: outcome.remotePath ?? null,
      sync_status: outcome.status,
      error_message: outcome.errorMessage ?? null,
      synced_at: outcome.status === "synchronise" ? new Date().toISOString() : null,
    }))
  );
}

/** Liste des cibles de stockage actives, sans exposer leur configuration — utilisable par n'importe quel rôle staff pour afficher où un fichier est répliqué. */
export async function listActiveStorageTargetsSummary() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("storage_targets").select("id,type,name,active,is_default").eq("active", true);
  return data ?? [];
}

const targetSchema = z.object({
  type: z.enum(["supabase_storage", "google_drive", "nas", "local_server"]),
  name: z.string().trim().min(2),
  bucket: z.string().trim().optional(),
  service_account_json: z.string().trim().optional(),
  root_folder_id: z.string().trim().optional(),
  url: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().trim().optional(),
  base_path: z.string().trim().optional(),
});

/** Création d'une cible de stockage — réservé à l'administrateur (section 9). */
export async function createStorageTarget(formData: FormData) {
  const { authId } = await requireRole(["administrateur"]);

  const parsed = targetSchema.safeParse({
    type: formData.get("type"),
    name: formData.get("name"),
    bucket: formData.get("bucket") || undefined,
    service_account_json: formData.get("service_account_json") || undefined,
    root_folder_id: formData.get("root_folder_id") || undefined,
    url: formData.get("url") || undefined,
    username: formData.get("username") || undefined,
    password: formData.get("password") || undefined,
    base_path: formData.get("base_path") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  let config: Record<string, unknown> = {};
  switch (parsed.data.type) {
    case "supabase_storage":
      if (!parsed.data.bucket) return { error: "Le nom du bucket Supabase Storage est requis" };
      config = { bucket: parsed.data.bucket };
      break;
    case "google_drive":
      if (!parsed.data.service_account_json || !parsed.data.root_folder_id) {
        return { error: "Le compte de service et le dossier racine Google Drive sont requis" };
      }
      config = { serviceAccountJson: parsed.data.service_account_json, rootFolderId: parsed.data.root_folder_id };
      break;
    case "nas":
    case "local_server":
      if (!parsed.data.url || !parsed.data.username || !parsed.data.password) {
        return { error: "L'URL WebDAV, l'identifiant et le mot de passe sont requis" };
      }
      config = {
        url: parsed.data.url,
        username: parsed.data.username,
        password: parsed.data.password,
        basePath: parsed.data.base_path || "/",
      };
      break;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("storage_targets").insert({
    type: parsed.data.type,
    name: parsed.data.name,
    config,
    created_by: authId,
  });

  if (error) return { error: error.message };
  revalidatePath("/admin/stockage");
  return {};
}

/** Active/désactive une cible de stockage — réservé à l'administrateur. */
export async function toggleStorageTargetActive(targetId: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("storage_targets").update({ active }).eq("id", targetId);
  if (error) return { error: error.message };
  revalidatePath("/admin/stockage");
  return {};
}
