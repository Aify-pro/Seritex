import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { COLONNES_LISTE, ENTETES_LISTE } from "./import";

/**
 * Lecture et écriture des classeurs Excel du personnel (migration 0159).
 * Côté serveur seulement : la liste du personnel est importée et exportée
 * au même « format spécial » (colonnes de COLONNES_LISTE).
 */

function texteCellule(valeur: ExcelJS.CellValue): string {
  if (valeur === null || valeur === undefined) return "";
  if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
  if (typeof valeur === "object") {
    if ("result" in valeur && valeur.result !== undefined) return texteCellule(valeur.result as ExcelJS.CellValue);
    if ("richText" in valeur) return valeur.richText.map((r) => r.text).join("");
    if ("text" in valeur) return String(valeur.text);
    return "";
  }
  return String(valeur).trim();
}

/**
 * Lecteur de secours pour les classeurs non standard (exports Sage : espace de
 * noms préfixé « x: », cellules texte en ligne, pas de table de chaînes
 * partagées). Lit la première feuille et renvoie des lignes de texte.
 */
async function lireClasseurSecours(octets: ArrayBuffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(octets);
  const decoder = (xml: string) =>
    xml
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, "&");
  const texteBalise = (xml: string) => decoder([...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1]).join(""));

  const partagees: string[] = [];
  const fichierPartagees = zip.file(/xl\/sharedStrings\.xml$/)[0];
  if (fichierPartagees) {
    for (const m of (await fichierPartagees.async("string")).matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)) partagees.push(texteBalise(m[1]));
  }
  const feuille = zip.file(/xl\/worksheets\/[^/]+\.xml$/).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
  if (!feuille) return [];

  const colonne = (reference: string) => [...reference.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const lignes: string[][] = [];
  for (const ligne of (await feuille.async("string")).matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const cellules: string[] = [];
    let suivante = 0;
    for (const c of ligne[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attributs = c[1];
      const reference = /\br="([A-Z]+\d+)"/.exec(attributs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attributs)?.[1];
      const contenu = c[2] ?? "";
      const brut = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(contenu)?.[1];
      let valeur = "";
      if (type === "inlineStr") valeur = texteBalise(contenu);
      else if (brut !== undefined) valeur = type === "s" ? (partagees[Number(brut)] ?? "") : decoder(brut);
      const position = reference ? colonne(reference) : suivante;
      while (cellules.length < position) cellules.push("");
      cellules[position] = valeur.trim();
      suivante = position + 1;
    }
    if (cellules.some((v) => v !== "")) lignes.push(cellules);
  }
  const largeur = Math.max(0, ...lignes.map((l) => l.length));
  return lignes.map((l) => Array.from({ length: largeur }, (_, i) => l[i] ?? ""));
}

/** Première feuille du classeur → tableau de lignes de texte (lignes vides ignorées). */
export async function lireClasseur(octets: ArrayBuffer): Promise<string[][]> {
  try {
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(octets);
    const feuille = classeur.worksheets[0];
    if (feuille) {
      const largeur = feuille.actualColumnCount || feuille.columnCount;
      const lignes: string[][] = [];
      feuille.eachRow({ includeEmpty: false }, (ligne) => {
        const cellules: string[] = [];
        for (let c = 1; c <= largeur; c++) cellules.push(texteCellule(ligne.getCell(c).value));
        if (cellules.some((v) => v !== "")) lignes.push(cellules);
      });
      return lignes;
    }
  } catch {
    // Classeur non standard (export Sage) : lecteur de secours ci-dessous.
  }
  return lireClasseurSecours(octets);
}

export interface LigneListe {
  matricule: string;
  nom: string;
  prenom: string;
  atelier: string;
  fonction: string;
  type_contrat: string;
  statut: string;
}

/** Classeur de la liste du personnel (modèle vide si `lignes` est vide). Matricules en texte : les zéros de tête sont conservés. */
export async function ecrireListe(lignes: LigneListe[]): Promise<Uint8Array> {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = "Seritex";
  const feuille = classeur.addWorksheet("Personnel");
  feuille.columns = COLONNES_LISTE.map((c) => ({ header: ENTETES_LISTE[c], key: c, width: c === "nom" || c === "fonction" ? 28 : 16 }));
  feuille.getRow(1).font = { bold: true };
  feuille.getColumn("matricule").numFmt = "@";
  feuille.views = [{ state: "frozen", ySplit: 1 }];
  for (const l of lignes) feuille.addRow(l);
  // Colonnes à valeurs fixes : listes déroulantes dans Excel.
  const dernier = Math.max(lignes.length + 200, 300);
  for (let r = 2; r <= dernier; r++) {
    feuille.getCell(r, 1).numFmt = "@";
    feuille.getCell(r, 6).dataValidation = { type: "list", allowBlank: true, formulae: ['"CDI,CDD"'] };
    feuille.getCell(r, 7).dataValidation = { type: "list", allowBlank: true, formulae: ['"actif,suspendu,sorti"'] };
  }
  return new Uint8Array(await classeur.xlsx.writeBuffer());
}
