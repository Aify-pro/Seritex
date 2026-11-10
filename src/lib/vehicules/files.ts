import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Dépôt d'un fichier du module Véhicules (photo, scan de document, ticket de
 * station, facture) dans le bucket privé `vehicules`. Appelé par une action
 * serveur APRÈS le contrôle du droit ; si l'enregistrement en base est
 * ensuite refusé, l'appelant retire le fichier (removeVehicleFile).
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

export type UploadOutcome = { path: string } | { error: string } | null;

/** null = aucun fichier fourni (champ vide). */
export async function uploadVehicleFile(folder: string, nature: string, file: FormDataEntryValue | null): Promise<UploadOutcome> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_BYTES) return { error: "Fichier trop lourd (10 Mo au plus)." };
  if (!ALLOWED.includes(file.type)) return { error: "Format accepté : photo (JPEG, PNG, WebP, HEIC) ou PDF." };
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${folder}/${nature}-${Date.now()}.${ext}`;
  const { error } = await createAdminClient()
    .storage.from("vehicules")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { error: `Fichier non enregistré : ${error.message}` };
  return { path };
}

export async function removeVehicleFile(path: string | null | undefined) {
  if (!path) return;
  await createAdminClient().storage.from("vehicules").remove([path]);
}
