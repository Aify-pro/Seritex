/**
 * Banc de test de la séparation des couleurs (src/lib/separation/separer.ts,
 * moteur Reveal) sur des visuels types générés à la volée :
 *  1. logo 4 couleurs sur fond blanc (JPEG) : 4 encres, fond retiré, petit texte conservé,
 *     sans liseré des autres formes sur son écran ;
 *  2. même logo sur fond transparent (PNG) sans le texte : 3 encres ;
 *  3. logo en JPEG très compressé et petit : toujours 3 encres (bruit et bords ignorés) ;
 *  4. texte 2 couleurs : 2 encres ;
 *  5. dégradé : signalé comme dégradé ;
 *  6. nombre de couleurs imposé : respecté ;
 *  7. films en pleine résolution : encres appliquées à 2 400 px, recadrage sur le
 *     dessin, aucun liseré parasite sur l'écran du petit texte, transparence tranchée.
 *
 * Lancer : npm run test:separation
 */
import assert from "node:assert/strict";
import sharp, { type Sharp } from "sharp";
import reveal from "../src/lib/separation/reveal-core.js";
import { appliquerEncres, separer, HORS_DESSIN, type OptionsSeparation } from "../src/lib/separation/separer";

const logo = (fond: string, texte: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">${fond}
<circle cx="800" cy="650" r="420" fill="#d62828"/><circle cx="800" cy="650" r="300" fill="#f77f00"/>
<polygon points="800,380 1000,800 600,800" fill="#003049"/>
<text x="800" y="1300" font-size="200" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#003049">SERITEX</text>
${texte ? '<text x="800" y="1450" font-size="90" font-family="Arial" text-anchor="middle" fill="#2a9d8f">Abidjan 2026</text>' : ""}</svg>`;
const BLANC = '<rect width="1600" height="1600" fill="white"/>';
const degrade = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0066"/><stop offset="1" stop-color="#3300cc"/></linearGradient></defs>
<rect width="1000" height="1000" fill="white"/><circle cx="500" cy="450" r="350" fill="url(#g)"/></svg>`;
const deux = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#ffffff"/>
<text x="400" y="250" font-size="150" font-family="Georgia" font-weight="bold" text-anchor="middle" fill="#1a7f37">Club ASEC</text><rect x="60" y="300" width="680" height="20" fill="#f5c400"/></svg>`;

async function analyser(img: Sharp, options?: OptionsSeparation) {
  const { data, info } = await img.resize(700, 700, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = Date.now();
  const r = await separer(reveal, new Uint8ClampedArray(data), info.width, info.height, options);
  return { ...r, ms: Date.now() - t };
}
const svg = (s: string) => sharp(Buffer.from(s));
const encodé = async (s: Sharp) => sharp(await s.toBuffer());
const proche = (hex: string, cible: string) => {
  const v = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [v(hex), v(cible)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 40;
};

let n = 0;
async function test(nom: string, fn: () => Promise<string>) {
  const detail = await fn();
  n += 1;
  console.log(`  ✓ ${nom} — ${detail}`);
}
const resume = (r: Awaited<ReturnType<typeof analyser>>) =>
  `${r.couleurs.map((c) => `${c.hex} ${(c.part * 100).toFixed(0)} %`).join(", ")} (${r.ms} ms)`;

async function main() {
console.log("Séparation des couleurs (moteur Reveal)");

await test("logo 4 couleurs sur fond blanc (JPEG)", async () => {
  const r = await analyser(await encodé(svg(logo(BLANC, true)).jpeg({ quality: 85 })));
  assert.equal(r.couleurs.length, 4, resume(r));
  for (const c of ["#D62828", "#F77F00", "#003049", "#2A9D8F"]) assert.ok(r.couleurs.some((x) => proche(x.hex, c)), `${c} absente : ${resume(r)}`);
  assert.equal(r.fond, "#FFFFFF");
  assert.equal(r.degrade, false);
  assert.equal(r.indices[0], HORS_DESSIN, "le fond n'est pas imprimé");
  // L'écran vert ne porte que le petit texte du bas : aucun liseré des autres formes.
  const vert = r.couleurs.findIndex((c) => proche(c.hex, "#2A9D8F"));
  let egares = 0;
  for (let p = 0; p < r.indices.length; p++) if (r.indices[p] === vert && Math.floor(p / r.largeur) < r.hauteur * 0.85) egares += 1;
  assert.ok(egares < 20, `${egares} pixels verts hors du texte`);
  return resume(r);
});

await test("logo sur fond transparent (PNG)", async () => {
  const r = await analyser(await encodé(svg(logo("", false)).png()));
  assert.equal(r.transparent, true);
  assert.equal(r.couleurs.length, 3, resume(r));
  assert.equal(r.degrade, false);
  return resume(r);
});

await test("logo petit et très compressé (JPEG qualité 35, 300 px)", async () => {
  const r = await analyser(await encodé(svg(logo(BLANC, false)).resize(300).jpeg({ quality: 35 })));
  assert.equal(r.couleurs.length, 3, resume(r));
  assert.equal(r.degrade, false);
  return resume(r);
});

await test("texte 2 couleurs", async () => {
  const r = await analyser(await encodé(svg(deux).jpeg({ quality: 80 })));
  assert.equal(r.couleurs.length, 2, resume(r));
  return resume(r);
});

await test("dégradé signalé", async () => {
  const r = await analyser(await encodé(svg(degrade).jpeg({ quality: 85 })));
  assert.equal(r.degrade, true, resume(r));
  return resume(r);
});

await test("nombre de couleurs imposé (2 sur le logo 4 couleurs)", async () => {
  const r = await analyser(await encodé(svg(logo(BLANC, true)).jpeg({ quality: 85 })), { nbCouleurs: 2 });
  assert.equal(r.couleurs.length, 2, resume(r));
  const somme = r.couleurs.reduce((s, c) => s + c.part, 0);
  assert.ok(Math.abs(somme - 1) < 1e-6, "les parts couvrent tout le dessin");
  return resume(r);
});

await test("nombre de couleurs imposé (6 sur le dégradé)", async () => {
  const r = await analyser(await encodé(svg(degrade).jpeg({ quality: 85 })), { nbCouleurs: 6 });
  assert.equal(r.couleurs.length, 6, resume(r));
  return resume(r);
});

await test("films : logo JPEG en pleine résolution", async () => {
  const fichier = await svg(logo(BLANC, true)).resize(2400).jpeg({ quality: 85 }).toBuffer();
  const r = await analyser(sharp(fichier));
  const { data, info } = await sharp(fichier).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = Date.now();
  const f = appliquerEncres(new Uint8ClampedArray(data), info.width, info.height, r.couleurs.map((c) => c.hex), r.fond, r.transparent);
  const ms = Date.now() - t;
  // Le dessin occupe x = 380..1220 sur 1600 (cercle et texte) : ~1260 px à 2 400 px.
  assert.ok(Math.abs(f.largeur - 1260) < 30, `largeur recadrée ${f.largeur}`);
  const vert = r.couleurs.findIndex((c) => proche(c.hex, "#2A9D8F"));
  let egares = 0;
  let verts = 0;
  for (let p = 0; p < f.indices.length; p++) {
    if (f.indices[p] !== vert) continue;
    verts += 1;
    if (Math.floor(p / f.largeur) < f.hauteur * 0.85) egares += 1;
  }
  assert.ok(verts > 1000, "le texte vert est sur son écran");
  // Aucun îlot de moins de 4 pixels sur aucun écran.
  for (let p = f.largeur + 1; p < f.indices.length - f.largeur - 1; p++) {
    const c = f.indices[p];
    if (c === HORS_DESSIN) continue;
    const voisins = [p - 1, p + 1, p - f.largeur, p + f.largeur].filter((q) => f.indices[q] === c).length;
    assert.ok(voisins > 0, `pixel isolé en ${p % f.largeur},${Math.floor(p / f.largeur)}`);
  }
  assert.ok(egares < 5, `${egares} pixels verts hors du texte`);
  return `${f.largeur} × ${f.hauteur} px, ${egares} pixel(s) vert(s) égaré(s) (${ms} ms)`;
});

await test("films : PNG transparent tranché à 50 % d'opacité", async () => {
  const fichier = await svg(logo("", false)).resize(2000).png().toBuffer();
  const r = await analyser(sharp(fichier));
  const { data, info } = await sharp(fichier).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const f = appliquerEncres(new Uint8ClampedArray(data), info.width, info.height, r.couleurs.map((c) => c.hex), r.fond, r.transparent);
  const coins = [0, f.largeur - 1, (f.hauteur - 1) * f.largeur].map((p) => f.indices[p]);
  assert.ok(coins.every((k) => k === HORS_DESSIN), "coins hors du dessin (cercle)");
  const encres = new Set(f.indices);
  encres.delete(HORS_DESSIN);
  assert.equal(encres.size, 3);
  return `${f.largeur} × ${f.hauteur} px, ${encres.size} encres`;
});

console.log(`${n} tests réussis`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
