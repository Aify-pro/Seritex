import "server-only";
import { createClient as createWebdavClient } from "webdav";
import type { StorageProvider, StorageTargetRow, UploadInput, UploadResult, WebdavConfig } from "@/lib/storage/types";
import { StorageProviderError } from "@/lib/storage/types";

/**
 * Réplication vers un NAS ou un serveur local (section 3.7/7.7 de
 * l'analyse), via le protocole WebDAV — choisi plutôt que SMB car joignable
 * en HTTPS depuis un hébergement cloud (Vercel) sans VPN. Le NAS/serveur
 * doit exposer une URL WebDAV accessible depuis Internet (idéalement
 * restreinte par IP ou par jeton — point réseau à valider avec l'IT interne,
 * section 11 de l'analyse).
 *
 * Utilisée à l'identique pour les deux cibles `nas` et `local_server` : la
 * distinction entre les deux n'est qu'une étiquette pour l'utilisateur
 * (section 3.7), la mécanique de copie est la même.
 */
export const webdavProvider: StorageProvider = {
  async upload(target: StorageTargetRow, input: UploadInput): Promise<UploadResult> {
    const config = target.config as unknown as Partial<WebdavConfig>;
    if (!config.url || !config.username || !config.password) {
      throw new StorageProviderError(
        target.type,
        "URL et identifiants WebDAV non configurés pour cette cible"
      );
    }

    try {
      const client = createWebdavClient(config.url, {
        username: config.username,
        password: config.password,
      });

      const basePath = (config.basePath ?? "/").replace(/\/+$/, "");
      const companyDir = `${basePath}/${sanitizeSegment(input.companyName)}`;
      const remotePath = `${companyDir}/${Date.now()}-${sanitizeSegment(input.fileName)}`;

      const dirExists = await client.exists(companyDir);
      if (!dirExists) {
        await client.createDirectory(companyDir, { recursive: true });
      }

      await client.putFileContents(remotePath, input.buffer, {
        overwrite: false,
        contentLength: input.buffer.length,
      });

      return { remotePath };
    } catch (error) {
      if (error instanceof StorageProviderError) throw error;
      throw new StorageProviderError(target.type, `Échec de la réplication WebDAV (${target.name})`, error);
    }
  },
};

function sanitizeSegment(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_ ]/g, "_");
}
