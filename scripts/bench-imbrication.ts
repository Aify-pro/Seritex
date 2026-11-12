/**
 * Banc d'essai du moteur d'imbrication — l'arbitre de la décision face à
 * Diamino / Modaris.
 *
 * Pour chaque cas d'un dossier et chaque budget de temps, lance le moteur
 * (WebAssembly, exactement comme en production ; ou binaire natif avec
 * --natif), CONTRÔLE le tracé avec la validation de Seritex, et compare la
 * longueur et le taux d'utilisation à la référence du cas (tracé Diamino,
 * meilleur résultat publié…). Produit un CSV et un rapport lisible.
 *
 * Formats de cas acceptés dans le dossier :
 *  - <cas>.json : entrée seritex.imbrication/v1 (le bloc « calcul » est
 *    remplacé par le budget testé) ;
 *  - <cas>.json au format d'instance jagua-rs / ESICUP (« items »,
 *    « strip_height »), converti automatiquement ;
 *  - <cas>.reference.json (facultatif) : { "longueur": 2471.5,
 *    "taux_utilisation": 0.874, "source": "Diamino" } (taux entre 0 et 1, ou
 *    en % s'il dépasse 1 ; mêmes unités que le cas).
 *  - Les cas Diamino fournis en DXF passeront par l'import DXF (Phase 2).
 *
 * Usage :
 *   npm run bench:imbrication -- <dossier> [--budgets 30,120,600]
 *     [--graine 1] [--sortie <dossier>] [--natif <binaire>] [--cas a,b]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { entreeSchema, sortieSchema, type EntreeImbrication, type SortieImbrication } from "../src/lib/imbrication/contrat";
import { imbriquer } from "../src/lib/imbrication/moteur";
import { validerTrace, type ResultatValidation } from "../src/lib/imbrication/validation";

interface Reference {
  longueur?: number;
  taux_utilisation?: number;
  source?: string;
}

interface Cas {
  nom: string;
  entree: EntreeImbrication;
  reference: Reference | null;
}

function option(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Instance jagua-rs / ESICUP → entrée seritex.imbrication/v1. */
function depuisJagua(nom: string, j: { items: unknown[]; strip_height: number; min_item_separation?: number }): EntreeImbrication {
  const pieces = j.items.map((brut) => {
    const it = brut as {
      id: number;
      demand: number;
      orientation?: { rotation?: { mode: string; angles?: number[]; step?: number } };
      shape: { type: string; data: unknown };
    };
    const rot = it.orientation?.rotation;
    let rotations: number[];
    if (!rot || rot.mode === "discrete") rotations = rot?.angles ?? [0];
    else if (rot.mode === "stepped" && rot.step) rotations = Array.from({ length: Math.round(360 / rot.step) }, (_, k) => k * rot.step!);
    else throw new Error(`${nom} : rotation « ${rot.mode} » non prise en charge par le contrat v1`);
    if (it.shape.type !== "simple_polygon") throw new Error(`${nom} : forme « ${it.shape.type} » non prise en charge`);
    return { id: `item-${it.id}`, contour: it.shape.data as [number, number][], quantite: it.demand, rotations };
  });
  return {
    version: "seritex.imbrication/v1",
    tissu: { largeur_utile: j.strip_height, marge_lisiere: 0 },
    espacement: j.min_item_separation ?? 0,
    calcul: { temps_max_s: 1, graine: 1 },
    pieces,
  };
}

function chargerCas(dossier: string, filtre: string[] | null): Cas[] {
  const cas: Cas[] = [];
  for (const f of readdirSync(dossier).sort()) {
    if (!f.endsWith(".json") || f.endsWith(".reference.json")) continue;
    const nom = f.slice(0, -5);
    if (filtre && !filtre.includes(nom)) continue;
    const brut = JSON.parse(readFileSync(path.join(dossier, f), "utf8"));
    const entree: EntreeImbrication = brut.version ? brut : depuisJagua(nom, brut);
    let reference: Reference | null = null;
    try {
      reference = JSON.parse(readFileSync(path.join(dossier, `${nom}.reference.json`), "utf8"));
      if (reference?.taux_utilisation && reference.taux_utilisation > 1) reference.taux_utilisation /= 100;
    } catch {
      reference = null;
    }
    cas.push({ nom, entree, reference });
  }
  return cas;
}

async function executer(
  entree: EntreeImbrication,
  natif: string | undefined
): Promise<{ sortie: SortieImbrication; validation: ResultatValidation } | { erreur: string }> {
  if (!natif) {
    const r = await imbriquer(entree);
    return r.ok ? { sortie: r.sortie, validation: r.validation } : { erreur: r.message };
  }
  const norm = entreeSchema.parse(entree);
  const brut = execFileSync(natif, { input: JSON.stringify(norm), maxBuffer: 1 << 28, encoding: "utf8" });
  const sortie = sortieSchema.parse(JSON.parse(brut));
  if (sortie.statut === "echec") return { erreur: sortie.erreur?.message ?? "échec" };
  return { sortie, validation: validerTrace(norm, sortie) };
}

const pct = (x: number) => `${(x * 100).toFixed(2)} %`;

async function main() {
  const dossier = process.argv[2];
  if (!dossier || dossier.startsWith("--")) {
    console.error("Usage : npm run bench:imbrication -- <dossier> [--budgets 30,120,600] [--graine 1] [--sortie <dossier>] [--natif <binaire>]");
    process.exit(1);
  }
  const budgets = (option("budgets") ?? "30,120,600").split(",").map(Number);
  const graine = Number(option("graine") ?? 1);
  const natif = option("natif");
  const filtre = option("cas")?.split(",") ?? null;
  const horodatage = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const sortieDir = option("sortie") ?? path.join("bench-imbrication", horodatage);
  mkdirSync(sortieDir, { recursive: true });

  const cas = chargerCas(dossier, filtre);
  const moteur = natif ? "natif" : "wasm";
  console.log(`${cas.length} cas × ${budgets.length} budgets (${budgets.join(", ")} s), moteur ${moteur}, graine ${graine}`);

  const lignes: string[][] = [];
  const entete = [
    "cas", "moteur", "budget_s", "statut", "trace_valide", "pieces", "longueur", "taux_utilisation", "temps_s",
    "reference_source", "reference_longueur", "reference_taux", "ecart_longueur_pct", "ecart_taux_points", "probleme",
  ];
  for (const c of cas) {
    const nbPieces = c.entree.pieces.reduce((s, p) => s + p.quantite, 0);
    for (const budget of budgets) {
      const entree = { ...c.entree, calcul: { temps_max_s: budget, graine, effort: null } };
      process.stdout.write(`  ${c.nom} (${nbPieces} pièces) · ${budget} s… `);
      const r = await executer(entree, natif);
      const ref = c.reference;
      if ("erreur" in r) {
        console.log(`ÉCHEC : ${r.erreur}`);
        lignes.push([c.nom, moteur, String(budget), "echec", "non", String(nbPieces), "", "", "", ref?.source ?? "", "", "", "", "", r.erreur]);
        continue;
      }
      const v = r.validation;
      const ecartL = ref?.longueur ? ((v.longueurMm - ref.longueur) / ref.longueur) * 100 : null;
      const ecartT = ref?.taux_utilisation ? (v.tauxUtilisation - ref.taux_utilisation) * 100 : null;
      console.log(
        `${v.valide ? "valide" : "INVALIDE"} · longueur ${v.longueurMm.toFixed(2)} · ${pct(v.tauxUtilisation)}` +
          (ecartL !== null ? ` · ${ecartL >= 0 ? "+" : ""}${ecartL.toFixed(2)} % vs ${ref?.source ?? "réf."}` : "")
      );
      lignes.push([
        c.nom, moteur, String(budget), r.sortie.statut, v.valide ? "oui" : "non", String(r.sortie.placements.length),
        v.longueurMm.toFixed(3), v.tauxUtilisation.toFixed(5), r.sortie.temps_calcul_s.toFixed(1),
        ref?.source ?? "", ref?.longueur?.toString() ?? "", ref?.taux_utilisation?.toFixed(5) ?? "",
        ecartL?.toFixed(3) ?? "", ecartT?.toFixed(3) ?? "", v.problemes.map((p) => p.message).join(" | "),
      ]);
    }
  }

  const csv = [entete, ...lignes].map((l) => l.map((v) => (/[;,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n");
  writeFileSync(path.join(sortieDir, "resultats.csv"), csv + "\n");

  const md: string[] = [
    `# Banc d'essai du moteur d'imbrication — ${new Date().toLocaleString("fr-FR")}`,
    "",
    `Moteur : ${moteur} (sparrow 0.3.0 / jagua-rs 1.0.0) · graine ${graine} · budgets ${budgets.join(", ")} s`,
    "",
    "Écart de longueur : négatif = tracé PLUS COURT que la référence (gain de tissu).",
    "",
    "| Cas | Budget | Valide | Longueur | Utilisation | Référence | Écart longueur | Écart utilisation |",
    "|---|---:|:---:|---:|---:|---|---:|---:|",
    ...lignes.map(
      (l) =>
        `| ${l[0]} | ${l[2]} s | ${l[4]} | ${l[6] ? Number(l[6]).toFixed(1) : "—"} | ${l[7] ? pct(Number(l[7])) : "—"} | ${l[9] || "—"} | ${l[12] ? `${Number(l[12]) >= 0 ? "+" : ""}${Number(l[12]).toFixed(2)} %` : "—"} | ${l[13] ? `${Number(l[13]) >= 0 ? "+" : ""}${Number(l[13]).toFixed(2)} pt` : "—"} |`
    ),
    "",
    lignes.some((l) => l[4] !== "oui")
      ? "⚠️ Au moins un tracé est en échec ou invalide : voir la colonne « probleme » du CSV."
      : "Tous les tracés ont passé le contrôle indépendant de Seritex (quantités, rotations, largeur, chevauchements, espacement).",
  ];
  writeFileSync(path.join(sortieDir, "rapport.md"), md.join("\n") + "\n");
  console.log(`\nRésultats : ${path.join(sortieDir, "resultats.csv")} et rapport.md`);
}

void main();
