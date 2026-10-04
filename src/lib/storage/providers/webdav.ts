import "server-only";
import { createClient as createWebdavClient, type WebDAVClient } from "webdav";
import type { ConnectionCheckResult, StorageProvider, StorageTargetRow, UploadInput, UploadResult, WebdavConfig } from "@/lib/storage/types";
import { atStep } from "@/lib/storage/diagnostics";
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
  async check(target: StorageTargetRow, { deep }): Promise<ConnectionCheckResult> {
    const checks: string[] = [];
    const client = await atStep(target.type, "Configuration", () => openClient(target));
    const base = baseOf(target) || "/";
    let warning: string | undefined;

    let baseExists = true;
    try {
      await atStep(target.type, `Connexion et authentification (lecture de ${base})`, () => client.getDirectoryContents(base));
      checks.push("Serveur joignable, identifiants acceptés");
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      baseExists = false;
      await atStep(target.type, "Connexion et authentification (lecture de la racine)", () => client.getDirectoryContents("/"));
      checks.push("Serveur joignable, identifiants acceptés");
      warning = `Le dossier de base « ${base} » n'existe pas : il sera créé au premier dépôt.`;
    }
    if (baseExists) checks.push(`Dossier de base « ${base} » trouvé`);

    if (deep && baseExists) {
      const probe = `${base === "/" ? "" : base}/.seritex-test-${Date.now()}.txt`;
      await atStep(target.type, "Écriture d'un fichier témoin", () =>
        client.putFileContents(probe, "test de connexion Seritex", { overwrite: true })
      );
      await atStep(target.type, "Suppression du fichier témoin", () => client.deleteFile(probe));
      checks.push("Écriture et suppression testées");
    } else if (deep) {
      checks.push("Écriture non testée (dossier de base absent)");
    }
    return { warning, checks };
  },

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

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: number; response?: { status?: number }; cause?: { status?: number } } | null;
  return e?.status ?? e?.response?.status ?? e?.cause?.status;
}

function baseOf(target: StorageTargetRow) {
  const config = target.config as unknown as Partial<WebdavConfig>;
  return (config.basePath ?? "/").replace(/\/+$/, "");
}

function sanitizeSegment(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_ ]/g, "_");
}
