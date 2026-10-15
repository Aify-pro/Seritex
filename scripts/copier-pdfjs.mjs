// Copie les ressources de pdf.js (polices standard, profils ICC, décodeurs wasm) dans public/pdfjs/,
// d'où la lecture des PDF de la séparation des couleurs les charge. Lancé avant dev et build ; public/pdfjs est ignoré par git.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(racine, "node_modules", "pdfjs-dist");
const cible = path.join(racine, "public", "pdfjs");
if (!fs.existsSync(source)) {
  console.warn("pdfjs-dist absent : copie ignorée");
  process.exit(0);
}
fs.rmSync(cible, { recursive: true, force: true });
for (const dossier of ["standard_fonts", "iccs", "wasm"]) fs.cpSync(path.join(source, dossier), path.join(cible, dossier), { recursive: true });
console.log("pdf.js : ressources copiées dans public/pdfjs");
