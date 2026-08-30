// Couche d'abstraction "fournisseur de stockage" pour la médiathèque
// (architecture/analyse-fonctionnelle-technique.md, section 3.7 et 5.2).
//
// Principe : la base de données ne stocke jamais le contenu d'un fichier,
// uniquement les métadonnées (table `media_files`/`media_file_versions`) et
// le chemin retourné ici par chaque fournisseur (table `media_file_copies`).
// Ajouter un futur support de stockage ne demande qu'une implémentation
// supplémentaire de `StorageProvider`, jamais une remodélisation.

import type { StorageTarget } from "@/lib/types/domain";

export type StorageBackendType = "supabase_storage" | "google_drive" | "nas" | "local_server";

export interface SupabaseStorageConfig {
  bucket: string;
}

export interface GoogleDriveConfig {
  // JSON complet du compte de service Google (clé privée incluse), tel que
  // téléchargé depuis Google Cloud Console. Jamais transmis au navigateur —
  // lu uniquement côté serveur depuis storage_targets.config (colonne
  // réservée à l'administrateur, voir la policy storage_targets_select).
  serviceAccountJson: string;
  // Dossier Drive racine dans lequel un sous-dossier par entreprise est créé
  // (ou réutilisé) au premier dépôt.
  rootFolderId: string;
}

// NAS et serveur local partagent la même configuration : un point d'accès
// WebDAV joignable en HTTPS (section 5.2 — choix retenu plutôt que SMB, pour
// rester accessible depuis un hébergement cloud sans VPN).
export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
  basePath?: string;
}

export type StorageTargetConfig =
  | ({ type: "supabase_storage" } & SupabaseStorageConfig)
  | ({ type: "google_drive" } & GoogleDriveConfig)
  | ({ type: "nas" } & WebdavConfig)
  | ({ type: "local_server" } & WebdavConfig);

export type StorageTargetRow = StorageTarget;

export interface UploadInput {
  companyId: string;
  companyName: string;
  fileName: string;
  mimeType: string | null;
  buffer: Buffer;
}

export interface UploadResult {
  remotePath: string;
}

export interface StorageProvider {
  /** Copie le fichier sur la cible et renvoie le chemin/identifiant distant. */
  upload(target: StorageTargetRow, input: UploadInput): Promise<UploadResult>;
}

export class StorageProviderError extends Error {
  constructor(
    public readonly targetType: StorageBackendType,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "StorageProviderError";
  }
}
