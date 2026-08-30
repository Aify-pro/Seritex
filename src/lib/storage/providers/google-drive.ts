import "server-only";
import { google } from "googleapis";
import { Readable } from "node:stream";
import type { GoogleDriveConfig, StorageProvider, StorageTargetRow, UploadInput, UploadResult } from "@/lib/storage/types";
import { StorageProviderError } from "@/lib/storage/types";

/**
 * Réplication vers Google Drive (section 3.7/7.6 de l'analyse). Nécessite un
 * compte de service Google (JSON de clé privée) et un dossier racine dédié à
 * Seritex, tous deux saisis par l'administrateur dans la page "Stockage"
 * (jamais exposés au client — storage_targets.config).
 *
 * Un sous-dossier est créé (ou réutilisé) par entreprise sous le dossier
 * racine, pour que l'arborescence Drive reste lisible directement depuis
 * l'interface Google Drive elle-même (recommandation section 7.6).
 */
export const googleDriveProvider: StorageProvider = {
  async upload(target: StorageTargetRow, input: UploadInput): Promise<UploadResult> {
    const config = target.config as unknown as Partial<GoogleDriveConfig>;
    if (!config.serviceAccountJson || !config.rootFolderId) {
      throw new StorageProviderError(
        "google_drive",
        "Compte de service et/ou dossier racine Google Drive non configurés pour cette cible"
      );
    }

    try {
      const credentials = JSON.parse(config.serviceAccountJson);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      const drive = google.drive({ version: "v3", auth });

      const companyFolderId = await findOrCreateCompanyFolder(drive, config.rootFolderId, input.companyName);

      const { data } = await drive.files.create({
        requestBody: {
          name: input.fileName,
          parents: [companyFolderId],
        },
        media: {
          mimeType: input.mimeType ?? "application/octet-stream",
          body: Readable.from(input.buffer),
        },
        fields: "id",
      });

      if (!data.id) {
        throw new StorageProviderError("google_drive", "Google Drive n'a renvoyé aucun identifiant de fichier");
      }

      return { remotePath: `drive:${data.id}` };
    } catch (error) {
      if (error instanceof StorageProviderError) throw error;
      throw new StorageProviderError("google_drive", "Échec de la réplication vers Google Drive", error);
    }
  },
};

async function findOrCreateCompanyFolder(
  drive: ReturnType<typeof google.drive>,
  rootFolderId: string,
  companyName: string
): Promise<string> {
  const safeName = companyName.replace(/'/g, "\\'");
  const { data: found } = await drive.files.list({
    q: `'${rootFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
  });

  const existing = found.files?.[0]?.id;
  if (existing) return existing;

  const { data: created } = await drive.files.create({
    requestBody: {
      name: companyName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    },
    fields: "id",
  });

  if (!created.id) {
    throw new StorageProviderError("google_drive", "Impossible de créer le dossier Google Drive de l'entreprise");
  }
  return created.id;
}
