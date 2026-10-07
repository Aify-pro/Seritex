"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, requirePlatformAdmin } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { checkTargetConnection, replicateToTargets, selectWriteTargets } from "@/lib/storage";
import type { ConnectionStatus, StorageTargetRow } from "@/lib/storage/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 Mo — cohérent avec une limite raisonnable pour un visuel/fiche technique

const uploadSchema = z.object({
  company_id: z.string().uuid(),
  category: z.enum(["visuel", "image_de_marque", "fiche_technique", "nuancier", "maquette", "autre"]),
  reason: z.string().trim().min(4, "La raison doit contenir au moins 4 caractères"),
  // Demande (requests.id, migration 0043) à laquelle affilier le fichier dès
  // son dépôt — utilisé quand l'upload part de la fenêtre de sélection
  // visuel/maquette d'un ODF/devis plutôt que de la médiathèque elle-même,
  // pour qu'il apparaisse immédiatement dans le dossier de cette demande.
  request_id: z.string().uuid().optional(),
});

/**
 * Dépose un nouveau fichier dans la médiathèque d'un client. La réplication
 * se fait automatiquement vers toutes les cibles de stockage actives
 * (section 3.7) — l'utilisateur qui dépose un fichier n'a pas à choisir un
 * support, Supabase Storage restant toujours actif par défaut.
 */
export async function uploadMediaFile(formData: FormData) {
  const { authId, profile } = await requireUser();

  const parsed = uploadSchema.safeParse({
    company_id: formData.get("company_id") || profile.company_id,
    category: formData.get("category") || "autre",
    reason: formData.get("reason"),
    request_id: formData.get("request_id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (profile.role === "client" && parsed.data.company_id !== profile.company_id) {
    return { error: "Accès refusé" };
  }
  // Le personnel dépose selon son droit « Créer » sur la médiathèque (le client, sur sa propre médiathèque).
  if (profile.role !== "client" && !(await can("mediatheque", "create"))) {
    return { error: "Votre rôle ne permet pas d'ajouter un fichier à la médiathèque." };
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

  if (parsed.data.request_id) {
    const { error: affiliationError } = await supabase.from("request_media_files").insert({
      request_id: parsed.data.request_id,
      media_file_id: mediaFile.id,
      added_by: authId,
    });
    if (affiliationError) return { error: affiliationError.message };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const replicationError = await replicateVersion({
    versionId,
    companyId: parsed.data.company_id,
    companyName: company?.name ?? "Client",
    fileName: file.name,
    mimeType: file.type || null,
    buffer,
  });
  if (replicationError) return { error: replicationError };

  revalidatePath(`/mediatheque/${parsed.data.company_id}`);
  return { mediaFileId: mediaFile.id };
}

const versionSchema = z.object({
  media_file_id: z.string().uuid(),
  reason: z.string().trim().min(4, "La raison doit contenir au moins 4 caractères"),
});

/** Ajoute une nouvelle version (mise à jour) d'un fichier existant — raison obligatoire, l'historique est conservé. */
export async function addMediaFileVersion(formData: FormData) {
  const { profile } = await requireUser();
  if (profile.role !== "client" && !(await can("mediatheque", "modify"))) {
    return { error: "Votre rôle ne permet pas de mettre à jour un fichier de la médiathèque." };
  }

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
  const replicationError = await replicateVersion({
    versionId,
    companyId: mediaFile.company_id,
    companyName,
    fileName: file.name,
    mimeType: file.type || null,
    buffer,
  });
  if (replicationError) return { error: replicationError };

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
 *
 * Dès qu'un NAS est actif il est le stockage exclusif (`selectWriteTargets`) :
 * si l'écriture y échoue, il n'existe aucune copie ailleurs, donc l'erreur
 * est renvoyée à l'utilisateur plutôt que passée sous silence.
 */
async function replicateVersion(params: {
  versionId: string;
  companyId: string;
  companyName: string;
  fileName: string;
  mimeType: string | null;
  buffer: Buffer;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data: targets } = await admin
    .from("storage_targets")
    .select("*")
    .eq("active", true);

  if (!targets || targets.length === 0) return null;

  const outcomes = await replicateToTargets(selectWriteTargets(targets as StorageTargetRow[]), {
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

  if (outcomes.length > 0 && outcomes.every((o) => o.status === "erreur")) {
    return `Le fichier n'a pas pu être enregistré sur le stockage (${outcomes[0].errorMessage ?? "erreur inconnue"}). Vérifiez que le NAS est joignable, puis redéposez-le.`;
  }
  return null;
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

/** Création d'une cible de stockage — réservé à l'administrateur de plateforme (section 9). */
export async function createStorageTarget(formData: FormData) {
  const { authId } = await requirePlatformAdmin();

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
  const { data: created, error } = await supabase
    .from("storage_targets")
    .insert({
      type: parsed.data.type,
      name: parsed.data.name,
      config,
      created_by: authId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/parametres/stockage");
  return { id: created.id as string };
}

/**
 * Teste la connexion d'une cible : « connecté » ou « non connecté » avec la cause
 * et un détail technique (secrets masqués). Réservé à l'administrateur de
 * plateforme. `deep` vérifie aussi l'écriture (fichier témoin créé puis
 * supprimé sur un NAS) — à n'utiliser que sur demande explicite.
 */
export async function checkStorageTarget(targetId: string, deep = false): Promise<ConnectionStatus> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: target } = await supabase.from("storage_targets").select("*").eq("id", targetId).maybeSingle();
  if (!target) {
    return { connected: false, checkedAt: new Date().toISOString(), durationMs: 0, message: "Cible introuvable (supprimée ?)." };
  }
  return checkTargetConnection(target as StorageTargetRow, { deep });
}

/**
 * Active/désactive une cible de stockage — réservé à l'administrateur de
 * plateforme. Refuse de désactiver la dernière cible active : un dépôt ne
 * serait alors enregistré nulle part.
 */
export async function toggleStorageTargetActive(targetId: string, active: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();

  if (!active) {
    const { data: others } = await supabase
      .from("storage_targets")
      .select("id")
      .eq("active", true)
      .neq("id", targetId);
    if (!others?.length) {
      return { error: "Impossible de désactiver la dernière cible active : plus aucun fichier ne serait enregistré." };
    }
  }

  const { data, error } = await supabase.from("storage_targets").update({ active }).eq("id", targetId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Modification refusée ou cible introuvable." };
  revalidatePath("/parametres/stockage");
  return {};
}

const updateTargetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères"),
  bucket: z.string().trim().optional(),
  service_account_json: z.string().trim().optional(),
  root_folder_id: z.string().trim().optional(),
  url: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  base_path: z.string().trim().optional(),
});

/**
 * Modifie une cible (le type est figé). Un mot de passe / JSON de compte de
 * service laissé vide conserve la valeur actuelle : ces secrets ne sont
 * jamais renvoyés au navigateur, donc jamais pré-remplis.
 */
export async function updateStorageTarget(formData: FormData) {
  await requirePlatformAdmin();

  const parsed = updateTargetSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    bucket: formData.get("bucket") || undefined,
    service_account_json: formData.get("service_account_json") || undefined,
    root_folder_id: formData.get("root_folder_id") || undefined,
    url: formData.get("url") || undefined,
    username: formData.get("username") || undefined,
    password: (formData.get("password") as string) || undefined,
    base_path: formData.get("base_path") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase.from("storage_targets").select("type, config").eq("id", d.id).single();
  if (!existing) return { error: "Cible introuvable" };
  const current = (existing.config ?? {}) as Record<string, unknown>;

  let config: Record<string, unknown>;
  switch (existing.type) {
    case "supabase_storage":
      if (!d.bucket) return { error: "Le nom du bucket est requis" };
      config = { ...current, bucket: d.bucket };
      break;
    case "google_drive":
      if (!d.root_folder_id) return { error: "Le dossier racine Google Drive est requis" };
      config = {
        ...current,
        rootFolderId: d.root_folder_id,
        serviceAccountJson: d.service_account_json ?? current.serviceAccountJson,
      };
      break;
    default:
      if (!d.url || !d.username) return { error: "L'URL WebDAV et l'identifiant sont requis" };
      config = {
        ...current,
        url: d.url,
        username: d.username,
        password: d.password ?? current.password,
        basePath: d.base_path || "/",
      };
  }

  const { data, error } = await supabase
    .from("storage_targets")
    .update({ name: d.name, config })
    .eq("id", d.id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Modification refusée ou cible introuvable." };
  revalidatePath("/parametres/stockage");
  return {};
}

/**
 * Supprime une cible. Refusée si des fichiers y ont déjà été copiés (les
 * chemins enregistrés deviendraient illisibles) ou si c'est la dernière cible
 * active : dans ce cas on propose de la désactiver.
 */
export async function deleteStorageTarget(targetId: string) {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { data: target } = await supabase.from("storage_targets").select("id, active").eq("id", targetId).single();
  if (!target) return { error: "Cible introuvable" };

  const { count } = await supabase
    .from("media_file_copies")
    .select("id", { count: "exact", head: true })
    .eq("storage_target_id", targetId);
  if (count) {
    return { error: `Suppression impossible : ${count} copie(s) de fichiers sont enregistrées sur cette cible. Désactivez-la plutôt.` };
  }

  if (target.active) {
    const { data: others } = await supabase.from("storage_targets").select("id").eq("active", true).neq("id", targetId);
    if (!others?.length) return { error: "Impossible de supprimer la dernière cible active." };
  }

  const { data, error } = await supabase.from("storage_targets").delete().eq("id", targetId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Suppression refusée." };
  revalidatePath("/parametres/stockage");
  return {};
}

const deleteMediaFileSchema = z.object({
  media_file_id: z.string().uuid(),
  reason: z.string().trim().min(3, "La raison doit contenir au moins 3 caractères"),
  company_id: z.string().uuid(),
});

/**
 * Supprime (logiquement) un fichier de la médiathèque — raison obligatoire,
 * même logique de traçabilité que le dépôt/la mise à jour (section 3.7).
 * L'autorisation réelle vient de `delete_media_file()` côté Postgres
 * (module `mediatheque`, action `delete`, matrice éditable depuis
 * Paramètres > Rôles & permissions) — `requireUser()` ne garantit ici
 * qu'une session valide, pas le droit d'agir.
 */
export async function deleteMediaFile(formData: FormData) {
  await requireUser();
  const parsed = deleteMediaFileSchema.safeParse({
    media_file_id: formData.get("media_file_id"),
    reason: formData.get("reason"),
    company_id: formData.get("company_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_media_file", {
    p_media_file_id: parsed.data.media_file_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath(`/mediatheque/${parsed.data.company_id}`);
  revalidatePath("/client/mediatheque");
  return {};
}
