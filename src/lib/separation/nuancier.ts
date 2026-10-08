/**
 * Nuancier d'encres (lot 3) : rapprochement des couleurs trouvées par la
 * séparation avec les encres de l'atelier (Paramètres > Nuancier d'encres).
 * Fonctions pures, sans DOM.
 */

export type Encre = {
  id: string;
  nom: string;
  hex: string;
  reference: string | null;
  sous_couche: boolean;
};

export type Rapprochement = { encre: Encre; ecart: number };

/** Libellé simple de l'écart de couleur (ΔE), pour l'infographiste. */
export type Qualite = "identique" | "proche" | "a-melanger";

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (#RRGGBB) → CIELAB (D65). */
export function lab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Écart de couleur ΔE76 entre deux couleurs #RRGGBB. */
export function ecart(a: string, b: string) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export const qualite = (e: number): Qualite => (e < 4 ? "identique" : e < 10 ? "proche" : "a-melanger");

export const LIBELLES_QUALITE: Record<Qualite, string> = {
  identique: "identique",
  proche: "proche",
  "a-melanger": "à mélanger",
};

/** Encres classées de la plus proche à la plus éloignée de la couleur. */
export function rapprocher(hex: string, encres: Encre[]): Rapprochement[] {
  return encres.map((encre) => ({ encre, ecart: ecart(hex, encre.hex) })).sort((x, y) => x.ecart - y.ecart);
}

/** Textile foncé : une sous-couche blanche est conseillée sous les couleurs. */
export function estFonce(hex: string | null | undefined) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  return lab(hex)[0] < 50;
}

/** Encre de sous-couche du nuancier (la première marquée), sinon null. */
export const encreSousCouche = (encres: Encre[]) => encres.find((e) => e.sous_couche) ?? null;
