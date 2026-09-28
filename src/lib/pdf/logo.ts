import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Logo Seritex recadré (sans la marge blanche du fichier source), utilisé
 * dans l'en-tête des PDF générés par l'app (ODF, fiche échantillon). Lu une
 * seule fois par process — pdf-lib a ensuite besoin de le ré-embarquer
 * (`pdfDoc.embedPng`) dans chaque document, mais les octets bruts sont mis
 * en cache ici pour éviter une lecture disque à chaque génération.
 */
let cached: Promise<Uint8Array> | null = null;

export function getLogoPngBytes(): Promise<Uint8Array> {
  if (!cached) {
    cached = readFile(path.join(process.cwd(), "src/lib/pdf/assets/logo-seritex-header.png"));
  }
  return cached;
}
