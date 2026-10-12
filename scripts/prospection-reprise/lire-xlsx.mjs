// Lecture minimale d'un classeur .xlsx (sans dépendance) : décompresse avec
// `unzip` (macOS / Linux) et renvoie, par onglet, les cellules en valeurs
// calculées (pas les formules). Suffisant pour la reprise ponctuelle de
// l'Excel PLANNING_FINAL ; pas un lecteur xlsx général.
import { execFileSync } from "node:child_process";

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

function lirePartie(fichier, partie) {
  return execFileSync("unzip", ["-p", fichier, partie], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
}

/** Colonne Excel (« A », « AB ») → index 0. */
export function colIndex(lettres) {
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Date Excel (numéro de série) → « AAAA-MM-JJ ». */
export function dateExcel(serie) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serie)) * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Renvoie { nomOnglet: lignes[] } où chaque ligne = { r: numéro, c: valeurs[] }. */
export function lireClasseur(fichier, onglets) {
  const partages = [...lirePartie(fichier, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""))
  );
  const wb = lirePartie(fichier, "xl/workbook.xml");
  const rels = lirePartie(fichier, "xl/_rels/workbook.xml.rels");
  const res = {};
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const nom = decode(m[1]);
    if (onglets && !onglets.includes(nom)) continue;
    const cible = (rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`)))[1];
    const xml = lirePartie(fichier, `xl/${cible.replace(/^\/?xl\//, "")}`);
    const lignes = [];
    for (const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const c = [];
      for (const x of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = (x[2].match(/t="(\w+)"/) || [])[1];
        const inner = x[3] || "";
        let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (t === "s" && v != null) v = partages[Number(v)];
        else if (t === "inlineStr") v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((y) => y[1]).join("");
        else if (t === "e") v = null;
        if (v != null) c[colIndex(x[1])] = typeof v === "string" ? decode(v) : v;
      }
      lignes.push({ r: Number(r[1]), c });
    }
    res[nom] = lignes;
  }
  return res;
}
