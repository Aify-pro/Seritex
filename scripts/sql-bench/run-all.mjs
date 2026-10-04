// Lance tous les scénarios SQL du banc (un fichier test-*.mjs par lot).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => /^test-.*\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) failed += 1;
}
if (failed) {
  console.error(`\n${failed} fichier(s) en échec`);
  process.exit(1);
}
console.log(`\n${files.length} fichier(s) de scénarios SQL OK`);
