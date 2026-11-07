import "server-only";
import ExcelJS from "exceljs";
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

/** Première feuille du classeur → tableau de lignes de texte (lignes vides ignorées). */
export async function lireClasseur(octets: ArrayBuffer): Promise<string[][]> {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(octets);
  const feuille = classeur.worksheets[0];
  if (!feuille) return [];
  const largeur = feuille.actualColumnCount || feuille.columnCount;
  const lignes: string[][] = [];
  feuille.eachRow({ includeEmpty: false }, (ligne) => {
    const cellules: string[] = [];
    for (let c = 1; c <= largeur; c++) cellules.push(texteCellule(ligne.getCell(c).value));
    if (cellules.some((v) => v !== "")) lignes.push(cellules);
  });
  return lignes;
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
