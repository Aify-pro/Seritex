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
 *     dessin, aucun liseré parasite sur l'écran du petit texte, transparence tranchée ;
 *  8. nuancier : encre la plus proche et qualité du rapprochement ; textile foncé ;
 *  9. sous-couche : réunion des encres, rentrée de la valeur demandée ;
 * 10. prix de revient sérigraphie : calcul à la main, grille proposée cohérente
 *     avec la formule des devis (src/lib/pricing.ts), prix au kg d'un article ;
 * 11. trames : AM (surface encrée = ton, linéature), Bayer et diffusion fidèles au
 *     ton, recouvrement, films complets selon le rendu ;
 * 12. réglages avancés : archétype choisi, nettoyage désactivé, recettes relues.
 *
 * Lancer : npm run test:separation
 */
import assert from "node:assert/strict";
import sharp, { type Sharp } from "sharp";
import reveal from "../src/lib/separation/reveal-core.js";
import { appliquerEncres, separer, sousCouche, HORS_DESSIN, type OptionsSeparation } from "../src/lib/separation/separer";
import { estFonce, qualite, rapprocher, type Encre } from "../src/lib/separation/nuancier";
import { chiffrer, grilleProposee, prixAuKg, type ParametresSerigraphie } from "../src/lib/separation/prix-revient";
import { printCostPerPiece } from "../src/lib/pricing";
import { ecransFilms, indicesRendu } from "../src/lib/separation/ecrans";
import { recouvrir, seuilsAM, tramerAM } from "../src/lib/separation/trame";
import { lireReglages, REGLAGES_DEFAUT } from "../src/lib/separation/reglages";

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

await test("nuancier : encre la plus proche, qualité, textile foncé", async () => {
  const encres: Encre[] = [
    { id: "1", nom: "Rouge vif", hex: "#D52B2B", reference: "PMS 485 C", sous_couche: false },
    { id: "2", nom: "Orange", hex: "#F58220", reference: null, sous_couche: false },
    { id: "3", nom: "Bleu nuit", hex: "#0B2545", reference: null, sous_couche: false },
    { id: "4", nom: "Blanc couvrant", hex: "#FFFFFF", reference: null, sous_couche: true },
  ];
  const r = rapprocher("#D62829", encres);
  assert.equal(r[0].encre.nom, "Rouge vif");
  assert.equal(qualite(r[0].ecart), "identique", `écart ${r[0].ecart}`);
  const vert = rapprocher("#2A9D8F", encres);
  assert.equal(qualite(vert[0].ecart), "a-melanger", "aucun vert dans le nuancier");
  assert.equal(estFonce("#0B2545"), true);
  assert.equal(estFonce("#FFFFFF"), false);
  assert.equal(estFonce(null), false);
  return `rouge → ${r[0].encre.nom} (ΔE ${r[0].ecart.toFixed(1)}), vert → ${qualite(vert[0].ecart)}`;
});

await test("sous-couche : réunion des encres, rentrée de 3 px", async () => {
  // Carré de 40 px de deux encres (gauche 0, droite 1) au centre d'un cadre de 60 px.
  const w = 60;
  const indices = new Uint8Array(w * w).fill(HORS_DESSIN);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) indices[y * w + x] = x < 30 ? 0 : 1;
  const blanc = sousCouche({ largeur: w, hauteur: w, indices }, 3);
  const dedans = (x: number, y: number) => blanc[y * w + x] === 1;
  assert.ok(dedans(30, 30), "centre couvert, sans coupure entre les deux encres");
  assert.ok(dedans(13, 30) && !dedans(12, 30), "bord gauche rentré de 3 px");
  assert.ok(dedans(46, 30) && !dedans(47, 30), "bord droit rentré de 3 px");
  assert.ok(!dedans(5, 5), "hors du dessin : rien");
  return "OK";
});

const PARAMS: ParametresSerigraphie = {
  coutEcran: 5000,
  calageMin: 15,
  tauxHoraire: 2000,
  impressionS: 18,
  sechagePiece: 5,
  gachePct: 5,
  depotGm2: 120,
  perteEncrePct: 20,
  prixEncreKg: 10_000,
  surfaceRefCm2: 300,
  quantiteRef: 100,
};

await test("prix de revient : calcul vérifié à la main (2 écrans, 100 pièces)", async () => {
  const c = chiffrer(PARAMS, [
    { libelle: "Rouge", surfaceCm2: 300, prixKg: 12_000 },
    { libelle: "Bleu", surfaceCm2: 100 },
  ], 100);
  // Fixe : 2 × 5 000 + 2 × 15 min × 2 000 F/h = 10 000 + 1 000.
  assert.equal(c.fixe.total, 11_000);
  // Encre rouge : 0,03 m² × 120 g × 1,2 = 4,32 g × 12 F/g = 51,84 F ; bleu : 1,44 g × 10 F/g = 14,4 F.
  assert.equal(c.parPiece.encre, 66.24);
  // Impression : 2 × 18 s × 2 000 F/h = 20 F ; séchage : 2 × 5 F = 10 F.
  assert.equal(c.parPiece.impression, 20);
  assert.equal(c.parPiece.sechage, 10);
  assert.equal(c.piecesImprimees, 105);
  assert.equal(c.total, 21_105.2); // 11 000 + 96,24 × 105
  assert.equal(c.prixManquants.length, 0);
  return `${c.parPieceBonne} F par pièce bonne`;
});

await test("prix de revient : encre sans prix signalée (ni article ni défaut)", async () => {
  const c = chiffrer({ ...PARAMS, prixEncreKg: null }, [{ libelle: "Vert", surfaceCm2: 50 }], 100);
  assert.deepEqual(c.prixManquants, ["Vert"]);
  assert.equal(c.ecrans[0].coutEncrePiece, null);
  return "signalée";
});

await test("grille proposée : la formule des devis retrouve le prix de revient", async () => {
  const { lignes, fraisEcran } = grilleProposee(PARAMS);
  assert.equal(lignes.length, 7);
  assert.equal(fraisEcran, 5500);
  const grid = { coutParNbCouleurs: Object.fromEntries(lignes.map((l) => [l.nbCouleurs, l.coutPiece])), fraisEcranParCouleur: fraisEcran };
  for (const l of lignes) {
    const devis = printCostPerPiece([{ label: "Poitrine", nbCouleurs: l.nbCouleurs } as never], grid, PARAMS.quantiteRef).cost;
    // Écart dû aux arrondis au franc supérieur et à la gâche arrondie à la pièce.
    assert.ok(Math.abs(devis - l.parPieceRef) <= 2 + l.nbCouleurs, `${l.nbCouleurs} couleur(s) : devis ${devis} / revient ${l.parPieceRef}`);
  }
  return lignes.map((l) => `${l.nbCouleurs}c ${l.coutPiece} F`).join(", ") + ` + ${fraisEcran} F/écran`;
});

await test("prix au kg d'un article encre : kg, g, litre, pièce", async () => {
  assert.equal(prixAuKg(10_000, 10, "kg"), 11_000);
  assert.equal(prixAuKg(12, 0, "g"), 12_000);
  assert.equal(prixAuKg(9000, 0, "l"), 9000);
  assert.equal(prixAuKg(500, 0, "piece"), null);
  assert.equal(prixAuKg(null, 0, "kg"), null);
  return "OK";
});

/** Image unie d'un mélange : part `t` de l'encre rouge sur fond blanc (bande blanche en bord, pour le fond). */
function melangeUni(t: number, w = 400, h = 400) {
  const px = new Uint8ClampedArray(w * h * 4);
  const [r, g, b] = [214 * t + 255 * (1 - t), 40 * t + 255 * (1 - t), 40 * t + 255 * (1 - t)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const bord = x < 4 || y < 4 || x >= w - 4 || y >= h - 4;
      px[o] = bord ? 255 : r;
      px[o + 1] = bord ? 255 : g;
      px[o + 2] = bord ? 255 : b;
      px[o + 3] = 255;
    }
  return px;
}
const couverture = (m: Uint8Array) => m.reduce((s, v) => s + (v ? 1 : 0), 0) / m.length;

await test("trame AM : la surface encrée suit le ton (rond, elliptique, ligne)", async () => {
  for (const forme of ["rond", "elliptique", "ligne"] as const) {
    const s = seuilsAM(forme);
    assert.equal(s.length, 64 * 64);
    for (const ton of [25, 50, 75]) {
      const m = tramerAM(() => Math.round((ton / 100) * 255), 600, 600, { ppp: 360, lpi: 45, angle: 22.5, forme, pointMinPct: 0, pointMaxPct: 100 });
      const c = couverture(m) * 100;
      assert.ok(Math.abs(c - ton) < 2.5, `${forme} ${ton} % → ${c.toFixed(1)} %`);
    }
  }
  return "écart < 2,5 points";
});

await test("trame AM : linéature respectée (nombre de points sur une ligne)", async () => {
  // 45 lpi à 360 ppp et angle 0° : 1 point tous les 8 px → 50 points sur 400 px.
  const m = tramerAM(() => 60, 400, 64, { ppp: 360, lpi: 45, angle: 0, forme: "rond", pointMinPct: 0, pointMaxPct: 100 });
  let points = 0;
  const y = 4; // milieu d'une rangée de cellules (8 px)
  for (let x = 1; x < 400; x++) if (m[y * 400 + x] && !m[y * 400 + x - 1]) points += 1;
  assert.ok(Math.abs(points - 50) <= 1, `${points} points`);
  return `${points} points sur 400 px`;
});

await test("trame AM : points minimum et maximum", async () => {
  const r = { ppp: 360, lpi: 45, angle: 22.5, forme: "rond" as const, pointMinPct: 8, pointMaxPct: 92 };
  assert.equal(couverture(tramerAM(() => Math.round(0.05 * 255), 200, 200, r)), 0, "ton sous le minimum : rien");
  assert.equal(couverture(tramerAM(() => Math.round(0.95 * 255), 200, 200, r)), 1, "ton au-dessus du maximum : aplat plein");
  return "OK";
});

await test("Bayer et diffusion : la part d'encre suit le mélange", async () => {
  for (const t of [0.25, 0.5, 0.75]) {
    const px = melangeUni(t);
    for (const rendu of [{ type: "bayer", maillage: 77 } as const, { type: "diffusion", algo: "floyd-steinberg" } as const, { type: "diffusion", algo: "atkinson" } as const]) {
      const idx = indicesRendu(px, 400, 400, { encres: ["#D62828"], fond: "#FFFFFF", transparent: false, rendu, ppp: 360 });
      let encre = 0;
      let dedans = 0;
      for (let y = 20; y < 380; y++)
        for (let x = 20; x < 380; x++) {
          dedans += 1;
          if (idx[y * 400 + x] === 0) encre += 1;
        }
      const c = encre / dedans;
      // Atkinson perd 1/4 de l'erreur : tons moyens plus contrastés, tolérance plus large.
      const tol = rendu.type === "diffusion" && rendu.algo === "atkinson" ? 0.12 : 0.04;
      assert.ok(Math.abs(c - t) < tol, `${JSON.stringify(rendu)} ${t} → ${c.toFixed(3)}`);
    }
  }
  return "OK";
});

await test("recouvrement : l'encre claire passe de 3 px sous la foncée, jamais sur le fond", async () => {
  const w = 40;
  const indices = new Uint8Array(w * w).fill(255);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) indices[y * w + x] = x < 20 ? 0 : 1; // 0 clair, 1 foncé
  const [clair, fonce] = recouvrir(indices, w, w, [200, 40], 3);
  assert.ok(clair[15 * w + 22] && !clair[15 * w + 23], "clair déborde de 3 px sous le foncé");
  assert.ok(!clair[15 * w + 8], "jamais sur le fond");
  assert.ok(!fonce[15 * w + 19], "le foncé garde son bord");
  return "OK";
});

await test("films selon le rendu : aplats, AM avec sous-couche, diffusion", async () => {
  const fichier = await svg(logo(BLANC, false)).resize(1200).jpeg({ quality: 85 }).toBuffer();
  const r = await analyser(sharp(fichier));
  const { data, info } = await sharp(fichier).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const base = { encres: r.couleurs.map((c) => c.hex), fond: r.fond, transparent: r.transparent, ppp: 300, pixelsMin: 4, recouvrementPx: 2, miroir: false };
  const aplat = ecransFilms(new Uint8ClampedArray(data), info.width, info.height, { ...base, rendu: { type: "aplat" }, sousCouche: null });
  assert.equal(aplat.ecrans.length, 3);
  const am = ecransFilms(new Uint8ClampedArray(data), info.width, info.height, {
    ...base,
    rendu: { type: "am", lpi: 45, angles: [22.5, 52.5, 82.5], forme: "rond", pointMinPct: 5, pointMaxPct: 95 },
    sousCouche: { rentrePx: 2 },
  });
  assert.equal(am.ecrans.length, 4, "sous-couche + 3 couleurs");
  assert.equal(am.ecrans[1].length, Math.ceil(am.largeur / 8) * am.hauteur);
  const fm = ecransFilms(new Uint8ClampedArray(data), info.width, info.height, { ...base, rendu: { type: "diffusion", algo: "stucki" }, sousCouche: null });
  assert.equal(fm.ecrans.length, 3);
  return `${aplat.largeur} × ${aplat.hauteur} px`;
});

await test("réglages avancés : archétype « Spot Color », écart CIE2000, sans lissage", async () => {
  const r = await analyser(await encodé(svg(logo(BLANC, true)).jpeg({ quality: 85 })), { profil: "spot_color", ecart: "cie2000", lissage: "off" });
  assert.equal(r.profil, "Spot Color");
  assert.ok(r.couleurs.length >= 3 && r.couleurs.length <= 5, resume(r));
  assert.ok(r.ecartMoyen >= 0);
  return `${resume(r)} · ΔE ${r.ecartMoyen}`;
});

await test("réglages avancés : sans nettoyage, les nuances de bord restent des couleurs", async () => {
  const source = await encodé(svg(logo(BLANC, false)).resize(300).jpeg({ quality: 35 }));
  const avec = await analyser(sharp(await source.toBuffer()));
  const sans = await analyser(sharp(await source.toBuffer()), { nettoyage: false, couvertureMinPct: 0.2 });
  assert.ok(sans.couleurs.length > avec.couleurs.length, `${sans.couleurs.length} vs ${avec.couleurs.length}`);
  return `${avec.couleurs.length} → ${sans.couleurs.length} couleurs`;
});

await test("recettes : relecture tolérante, réglages invalides refusés", async () => {
  assert.deepEqual(lireReglages({}), REGLAGES_DEFAUT);
  const am = lireReglages({ rendu: { type: "am", lpi: 55, angles: [22.5, 52.5], forme: "elliptique", pointMinPct: 6, pointMaxPct: 94 }, ppp: 600 });
  assert.equal(am?.rendu.type, "am");
  assert.equal(am?.ppp, 600);
  assert.equal(am?.moteur.profil, "auto", "moteur complété par défaut");
  assert.equal(lireReglages({ rendu: { type: "am", lpi: 500, angles: [0], forme: "rond", pointMinPct: 5, pointMaxPct: 95 } }), null, "linéature hors bornes");
  assert.equal(lireReglages({ ppp: "beaucoup" }), null);
  return "OK";
});

console.log(`${n} tests réussis`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
