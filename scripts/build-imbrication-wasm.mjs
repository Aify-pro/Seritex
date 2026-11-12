/**
 * Reconstruit le moteur d'imbrication embarqué dans Seritex :
 *   rust/imbrication  →  src/lib/imbrication/moteur/seritex-imbrication.wasm
 *
 * Le fichier .wasm est COMMITÉ (comme src/lib/separation/reveal-core.js) :
 * ni Vercel ni un futur serveur Seritex n'ont besoin de Rust pour déployer.
 * Ce script n'est donc à lancer qu'après une modification du code Rust ou
 * une montée de version de sparrow / jagua-rs.
 *
 * Il écrit aussi :
 *  - src/lib/imbrication/moteur/version.json : versions, empreinte SHA-256 ;
 *  - la section « moteur d'imbrication » de THIRD_PARTY_LICENSES, à partir
 *    des licences déclarées par chaque dépendance Rust embarquée.
 *
 * Prérequis : rustup (la version de Rust est figée par
 * rust/imbrication/rust-toolchain.toml, installée automatiquement).
 *
 * Usage : npm run build:imbrication
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const crate = path.join(racine, "rust/imbrication");
const cible = "wasm32-wasip1";
const sortieDir = path.join(racine, "src/lib/imbrication/moteur");
const wasm = path.join(sortieDir, "seritex-imbrication.wasm");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: crate, encoding: "utf8", ...opts });

console.log("Compilation du moteur (Rust → WebAssembly)…");
run("cargo", ["build", "--release", "--locked", "--target", cible], { stdio: "inherit" });

mkdirSync(sortieDir, { recursive: true });
copyFileSync(path.join(crate, `target/${cible}/release/seritex-imbrication.wasm`), wasm);
const octets = readFileSync(wasm);

const cargo = readFileSync(path.join(crate, "Cargo.toml"), "utf8");
const versionWrapper = cargo.match(/^version = "([^"]+)"/m)[1];
const contrat = readFileSync(path.join(crate, "src/contrat.rs"), "utf8");
const constante = (nom) => contrat.match(new RegExp(`${nom}: &str = "([^"]+)"`))[1];

const version = {
  contrat: constante("VERSION_CONTRAT"),
  wrapper: versionWrapper,
  sparrow: constante("VERSION_SPARROW"),
  jagua_rs: constante("VERSION_JAGUA"),
  rustc: run("rustc", ["--version"]).trim(),
  cible,
  taille_octets: octets.length,
  sha256: createHash("sha256").update(octets).digest("hex"),
};
writeFileSync(path.join(sortieDir, "version.json"), JSON.stringify(version, null, 2) + "\n");

// Licences des dépendances Rust réellement compilées dans le module.
const arbre = run("cargo", ["tree", "--locked", "--target", cible, "-e", "normal", "--prefix", "none", "--format", "{p}\t{l}"]);
const deps = new Map();
for (const ligne of arbre.split("\n")) {
  const [paquet, licence] = ligne.split("\t");
  if (!paquet || paquet.startsWith("seritex-imbrication")) continue;
  const [nom, ver] = paquet.split(" ");
  deps.set(`${nom} ${ver}`, licence?.trim() || (nom === "sparrow" ? "MIT" : "non déclarée"));
}
const lignes = [...deps.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, l]) => `- ${p} — ${l}`);

const fichierLicences = path.join(racine, "THIRD_PARTY_LICENSES");
const debut = "<!-- debut:moteur-imbrication (généré par scripts/build-imbrication-wasm.mjs) -->";
const fin = "<!-- fin:moteur-imbrication -->";
const section = [
  debut,
  "## Moteur d'imbrication (src/lib/imbrication/moteur/seritex-imbrication.wasm)",
  "",
  "Dépendances Rust compilées dans le module WebAssembly, avec la licence qu'elles déclarent.",
  "sparrow (MIT) et jagua-rs (MPL-2.0) sont utilisés sans modification ; le code source",
  "de jagua-rs 1.0.0 est disponible sur https://github.com/JeroenGar/jagua-rs (tag v1.0.0),",
  "celui de sparrow 0.3.0 sur https://github.com/JeroenGar/sparrow (tag v0.3.0).",
  "",
  ...lignes,
  fin,
].join("\n");
let existant = "";
try {
  existant = readFileSync(fichierLicences, "utf8");
} catch {
  existant = "# Licences des composants tiers embarqués dans Seritex\n\n";
}
const re = new RegExp(`${debut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${fin}`);
writeFileSync(fichierLicences, re.test(existant) ? existant.replace(re, section) : `${existant.trimEnd()}\n\n${section}\n`);

console.log(`Moteur prêt : ${path.relative(racine, wasm)} (${(octets.length / 1024 / 1024).toFixed(2)} Mo, sha256 ${version.sha256.slice(0, 12)}…)`);
console.log(`${deps.size} dépendances Rust listées dans THIRD_PARTY_LICENSES.`);
