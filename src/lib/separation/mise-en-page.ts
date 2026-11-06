/**
 * Mise en page des films sur le support (A5, A4, A3) : format de feuille et
 * grille de films par feuille. Sans DOM.
 */
export const FORMATS_PAGE = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
} as const;
export type FormatPage = "auto" | keyof typeof FORMATS_PAGE;

/** Le film ne tient pas sur le format demandé : message à montrer tel quel. */
export class ErreurMiseEnPage extends Error {}


export type MiseEnPage = { pl: number; ph: number; cols: number; rows: number };

/**
 * Format de page et grille de films. `cl` × `ch` : une case (film, marges et légende), en mm.
 * Sans regroupement, une case par page ; avec, autant de cases que le format en contient
 * (portrait ou paysage, le plus rempli). « auto » : plus petit format A4/A3 qui convient,
 * ou A3 quand on regroupe ; sur mesure si rien ne convient.
 */
export function miseEnPage(cl: number, ch: number, format: FormatPage, grouper: boolean): MiseEnPage {
  const noms: (keyof typeof FORMATS_PAGE)[] = format === "auto" ? (grouper ? ["A3"] : ["A4", "A3"]) : [format];
  for (const nom of noms) {
    const [a, b] = FORMATS_PAGE[nom];
    let meilleur: MiseEnPage | null = null;
    for (const [pl, ph] of [[a, b], [b, a]]) {
      const cols = Math.floor(pl / cl);
      const rows = Math.floor(ph / ch);
      if (!cols || !rows) continue;
      if (!meilleur || cols * rows > meilleur.cols * meilleur.rows) meilleur = { pl, ph, cols, rows };
    }
    if (meilleur) return grouper ? meilleur : { ...meilleur, cols: 1, rows: 1 };
  }
  if (format !== "auto") {
    throw new ErreurMiseEnPage(`Le film (${Math.ceil(cl)} × ${Math.ceil(ch)} mm avec marges et légende) ne tient pas sur du ${format} : choisissez un format plus grand ou une largeur d'impression plus petite.`);
  }
  return { pl: Math.ceil(cl), ph: Math.ceil(ch), cols: 1, rows: 1 };
}
