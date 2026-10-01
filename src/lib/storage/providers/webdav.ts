import "server-only";
import { createClient as createWebdavClient, type WebDAVClient } from "webdav";
import type { StorageProvider, StorageTargetRow, UploadInput, UploadResult, WebdavConfig } from "@/lib/storage/types";
import { StorageProviderError } from "@/lib/storage/types";

/**
 * Stockage sur un NAS ou un serveur local (section 3.7/7.7 de l'analyse), via
 * le protocole WebDAV — choisi plutôt que SMB car joignable en HTTPS depuis un
 * hébergement cloud (Vercel) sans VPN. Le NAS/serveur doit exposer une URL
 * WebDAV accessible depuis Internet (idéalement restreinte par IP ou par
 * jeton — point réseau à valider avec l'IT interne, section 11 de l'analyse).
 *
 * Utilisée à l'identique pour les deux cibles `nas` et `local_server` : la
 * distinction entre les deux n'est qu'une étiquette pour l'utilisateur
 * (section 3.7), la mécanique de copie est la même.
 *
 * `remotePath` est toujours le chemin complet depuis la racine du serveur
 * WebDAV (basePath inclus) : il suffit à relire ou supprimer le fichier.
 */
export const webdavProvider: StorageProvider = {
  async upload(target: StorageTargetRow, input: UploadInput): Promise<UploadResult> {
    const client = openClient(target);
    try {
      const basePath = baseOf(target);
      const remotePath = input.relativePath
        ? `${basePath}/${input.relativePath.split("/").map(sanitizeSegment).join("/")}`
        : `${basePath}/${sanitizeSegment(input.companyName)}/${Date.now()}-${sanitizeSegment(input.fileName)}`;
      const dir = remotePath.slice(0, remotePath.lastIndexOf("/"));

      if (dir && !(await client.exists(dir))) {
        await client.createDirectory(dir, { recursive: true });
      }

      await client.putFileContents(remotePath, input.buffer, {
        overwrite: false,
        contentLength: input.buffer.length,
      });

      return { remotePath };
    } catch (error) {
      throw new StorageProviderError(target.type, `Échec de l'écriture WebDAV (${target.name})`, error);
    }
  },

  async download(target: StorageTargetRow, remotePath: string): Promise<Buffer> {
    const client = openClient(target);
    try {
      const content = (await client.getFileContents(remotePath, { format: "binary" })) as Buffer | ArrayBuffer;
      return Buffer.isBuffer(content) ? content : Buffer.from(content);
    } catch (error) {
      throw new StorageProviderError(target.type, `Lecture WebDAV impossible (${target.name})`, error);
    }
  },

  async remove(target: StorageTargetRow, remotePath: string): Promise<void> {
    const client = openClient(target);
    try {
      if (await client.exists(remotePath)) await client.deleteFile(remotePath);
    } catch (error) {
      throw new StorageProviderError(target.type, `Suppression WebDAV impossible (${target.name})`, error);
    }
  },
};

function openClient(target: StorageTargetRow): WebDAVClient {
  const config = target.config as unknown as Partial<WebdavConfig>;
  if (!config.url || !config.username || !config.password) {
    throw new StorageProviderError(target.type, "URL et identifiants WebDAV non configurés pour cette cible");
  }
  return createWebdavClient(config.url, { username: config.username, password: config.password });
}

function baseOf(target: StorageTargetRow) {
  const config = target.config as unknown as Partial<WebdavConfig>;
  return (config.basePath ?? "/").replace(/\/+$/, "");
}

function sanitizeSegment(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_ ]/g, "_");
}
