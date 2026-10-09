/**
 * Reconstruit src/lib/separation/reveal-core.js à partir du moteur Reveal
 * (fork Aify-pro/reveal-s-rigraphie-, paquet packages/reveal-core, licence
 * Apache 2.0).
 *
 * Usage : node scripts/build-reveal-core.mjs <chemin du clone du fork>
 *
 * Le moteur est écrit en CommonJS pour Node : on le regroupe en un seul module
 * ES pour le navigateur (Web Worker), sans fs/path et sans journaux console.
 * Les archétypes (fichiers JSON lus sur disque par Node) sont intégrés au
 * module et préchargés dans ArchetypeLoader.
 * Le même fichier est copié tel quel dans le dépôt du site (www.seritex.ci).
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const fork = process.argv[2];
if (!fork) {
  console.error("Usage : node scripts/build-reveal-core.mjs <chemin du clone du fork reveal>");
  process.exit(1);
}
const core = path.resolve(fork, "packages/reveal-core");
const commit = execSync("git rev-parse --short HEAD", { cwd: fork }).toString().trim();
const sortie = path.resolve("src/lib/separation/reveal-core.js");

const sansNode = {
  name: "sans-node",
  setup(b) {
    b.onResolve({ filter: /^(fs|path)$/ }, () => ({ path: "vide", namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "module.exports = {};" }));
    // Journaux du moteur coupés : process n'existe pas dans le navigateur.
    b.onLoad({ filter: /lib[\\/]utils[\\/]logger\.js$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(/const isSilent = [^;]+;/, "const isSilent = true;"),
      loader: "js",
    }));
  },
};

// Entrée : le moteur + ses archétypes intégrés (lus sur disque sous Node).
const archetypes = readdirSync(path.join(core, "archetypes")).filter((f) => f.endsWith(".json") && f !== "schema.json").sort();
const entree = `
const Reveal = require("./index.js");
const L = Reveal.ArchetypeLoader;
L.archetypes = [${archetypes.map((f) => `require("./archetypes/${f}")`).join(", ")}]
  .map((a) => L._applyDefaults(a))
  .sort((a, b) => a.id.localeCompare(b.id));
module.exports = Reveal;
`;

const r = await build({
  stdin: { contents: entree, resolveDir: core, loader: "js", sourcefile: "entree-reveal.js" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  write: false,
  plugins: [sansNode],
});

const entete = `/* eslint-disable */
// @ts-nocheck
/*
 * Reveal — moteur de séparation des couleurs pour la sérigraphie.
 * Copyright 2026 Electrosaur Labs. Licence Apache 2.0 (voir LICENSE-reveal.txt).
 * Source : github.com/Aify-pro/reveal-s-rigraphie- (fork de electrosaur-labs/reveal), commit ${commit}.
 * Fichier GÉNÉRÉ par scripts/build-reveal-core.mjs : ne pas modifier à la main.
 * Modification par rapport à l'original : regroupement en un module ES pour le
 * navigateur, accès fichiers (fs/path) et journaux console retirés.
 */
`;
writeFileSync(sortie, entete + r.outputFiles[0].text);

// Liste des archétypes pour l'interface (sans charger le moteur).
const liste = archetypes
  .map((f) => JSON.parse(readFileSync(path.join(core, "archetypes", f), "utf8")))
  .map((a) => ({ id: a.id, nom: a.name, groupe: a.group ?? null, description: a.description ?? "" }))
  .sort((a, b) => a.nom.localeCompare(b.nom));
writeFileSync(
  path.resolve("src/lib/separation/archetypes.ts"),
  `// Fichier GÉNÉRÉ par scripts/build-reveal-core.mjs (archétypes du moteur Reveal) : ne pas modifier à la main.\n` +
    `export type Archetype = { id: string; nom: string; groupe: string | null; description: string };\n\n` +
    `export const ARCHETYPES: Archetype[] = ${JSON.stringify(liste, null, 2)};\n`,
);
console.log(`${sortie} : ${(r.outputFiles[0].text.length / 1024).toFixed(0)} Ko (commit ${commit})`);
