/**
 * Codification des articles Seritex (COM-0, A4, A7) — miroir pur de
 * generate_variant_code() (migration 0076), qui fait autorité. Sert à
 * prévisualiser un code dans Paramètres > Codification et au banc de test
 * `npm run test:codification`.
 *
 * Format par défaut : modèle + matière + grammage + couleur + taille, sans
 * séparateur — ex. TS012JE165BLAXL. Suffixe d'état pour Sage (Q-COM-1) :
 * rien = vierge 1er choix, P = personnalisé, D = 2e choix. Le suffixe compte
 * dans la longueur maximale (18 caractères, limite Sage confirmée).
 */

export const CODE_SEGMENTS = ["modele", "matiere", "grammage", "couleur", "taille", "dimension"] as const;
export type CodeSegment = (typeof CODE_SEGMENTS)[number];

export const CODE_SEGMENT_LABELS: Record<CodeSegment, string> = {
  modele: "Modèle",
  matiere: "Matière",
  grammage: "Grammage",
  couleur: "Couleur",
  taille: "Taille",
  dimension: "Dimension",
};

/**
 * Une règle de codification par nature d'article (migration 0102) : segments
 * possibles, segment obligatoire, et suffixe d'état (vierge / P / D) — ce
 * dernier propre aux produits finis.
 */
export type CodingNature = "pf" | "mp" | "consommable";

export const CODING_NATURE_RULES: Record<
  CodingNature,
  { label: string; segments: CodeSegment[]; required: CodeSegment[]; etatSuffix: boolean; optional: CodeSegment[]; exemple: CodeParts }
> = {
  pf: {
    label: "Produits finis",
    segments: ["modele", "matiere", "grammage", "couleur", "taille"],
    required: ["modele"],
    etatSuffix: true,
    optional: [],
    exemple: { modele: "TS012", matiere: "JE", grammage: "165", couleur: "BLA", taille: "XL" },
  },
  mp: {
    label: "Matières premières (tissus)",
    segments: ["modele", "matiere", "grammage", "couleur"],
    required: [],
    etatSuffix: false,
    optional: [],
    exemple: { modele: "JER", matiere: "JE", grammage: "180", couleur: "BLA" },
  },
  consommable: {
    label: "Consommables",
    segments: ["modele", "couleur", "dimension"],
    required: ["modele"],
    etatSuffix: false,
    // Un consommable peut n'avoir que la couleur ou que la dimension.
    optional: ["couleur", "dimension"],
    exemple: { modele: "COBO0001", couleur: "BLA", dimension: "12" },
  },
};

export type StockEtat = "vierge" | "personnalise" | "deuxieme_choix";

export const STOCK_ETAT_SUFFIXES: Record<StockEtat, string> = {
  vierge: "",
  personnalise: "P",
  deuxieme_choix: "D",
};

export const STOCK_ETAT_LABELS: Record<StockEtat, string> = {
  vierge: "Vierge (1er choix)",
  personnalise: "Personnalisé",
  deuxieme_choix: "2e choix",
};

export interface CodingSettings {
  segments: CodeSegment[];
  longueurMax: number;
  separateur: string;
}

/** Règle par défaut des produits finis. */
export const DEFAULT_CODING: CodingSettings = { segments: ["modele", "matiere", "grammage", "couleur", "taille"], longueurMax: 18, separateur: "" };

export type CodeParts = Partial<Record<CodeSegment, string | null>>;

export type CodeResult = { code: string } | { error: string };

/** Code court proposé par défaut : majuscules, sans accents ni ponctuation, tronqué. */
export function defaultShortCode(text: string, length: number): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, length);
}

/**
 * Code d'une déclinaison ; refuse un segment manquant ou un code trop long.
 * Produits finis (par défaut) : le suffixe d'état compte dans la longueur.
 * `optional` : segments sautés quand l'axe est absent (consommable sans
 * couleur ou sans dimension) — même règle que generate_article_variant_code().
 */
export function variantCode(
  parts: CodeParts,
  settings: CodingSettings = DEFAULT_CODING,
  options: { etatSuffix?: boolean; optional?: CodeSegment[] } = {}
): CodeResult {
  const etatSuffix = options.etatSuffix ?? true;
  const values: string[] = [];
  for (const seg of settings.segments) {
    const v = parts[seg];
    if (!v) {
      if (options.optional?.includes(seg) && v === undefined) continue;
      return { error: `Segment « ${CODE_SEGMENT_LABELS[seg]} » sans code court` };
    }
    values.push(v);
  }
  const code = values.join(settings.separateur);
  const longueur = code.length + (etatSuffix ? 1 : 0);
  if (longueur > settings.longueurMax) {
    return {
      error: `Le code ${code} (${longueur} caractères${etatSuffix ? " suffixe compris" : ""}) dépasse ${settings.longueurMax}`,
    };
  }
  return { code };
}

/**
 * Code complet d'un rouleau (décision du 2026-10-06) : déclinaison, laize en
 * cm, poids en hectogrammes — ex. JE180BLA-178-224 pour 178 cm et 22,4 kg.
 */
export function rollFullCode(variantCodeValue: string, laizeCm: number | null, poidsKg: number): string {
  const laize = laizeCm != null ? String(Math.round(laizeCm)) : "000";
  return `${variantCodeValue}-${laize}-${Math.round(poidsKg * 10)}`;
}

/** Code de l'article stockable d'une déclinaison, pour un état donné. */
export function stockArticleCode(variantCodeValue: string, etat: StockEtat): string {
  return variantCodeValue + STOCK_ETAT_SUFFIXES[etat];
}

/** Code du modèle : code court de la catégorie + numéro suivant sur 3 chiffres (TS012). */
export function nextModelCode(categoryCode: string, existingCodes: string[]): string {
  const numbers = existingCodes
    .filter((c) => c.startsWith(categoryCode) && /^\d+$/.test(c.slice(categoryCode.length)))
    .map((c) => Number(c.slice(categoryCode.length)));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return categoryCode + String(next).padStart(3, "0");
}

/** Codes en double dans un ensemble (déclinaisons d'un modèle, par exemple). */
export function duplicateCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const c of codes) {
    if (seen.has(c)) dups.add(c);
    seen.add(c);
  }
  return [...dups];
}
