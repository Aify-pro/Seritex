/**
 * Blancs des textiles foncés : sous-couche (imprimée en premier, sous les
 * couleurs) et blanc de rehaut (imprimé en dernier, hautes lumières).
 * Fonctions pures, partagées par l'aperçu, la loupe et les films.
 *
 * Sous-couche :
 *  - aplat plein ou tramée (automatique : tramée si les couleurs sont
 *    tramées en AM ou en quadrichromie) ;
 *  - ton selon les encres (là où il y a de l'encre, à sa couverture) ou
 *    selon la luminosité de l'image (plus de blanc dans les clairs) ;
 *  - densité, pas de blanc sous les tons foncés (le textile sert de noir),
 *    rentré sous les couleurs.
 * Rehaut : blanc tramé sur les seules hautes lumières (au-dessus d'un seuil
 * de luminosité), pour leur rendre leur éclat après les couleurs.
 */
import { HORS_DESSIN, sousCouche } from "./separer";
import { tramerAM, type FormePoint, type Rendu } from "./trame";

export type TrameBlanc = { lpi: number; angle: number; forme: FormePoint; pointMinPct: number; pointMaxPct: number };

export type OptionsSousCouche = {
  active: boolean;
  mode: "auto" | "aplat" | "tramee";
  source: "encres" | "luminosite";
  /** 0 à 100 %. */
  densitePct: number;
  /** Luminosité (L*, 0 à 100) en dessous de laquelle aucun blanc n'est posé ; 0 = désactivé. */
  sansSousFoncesL: number;
  trame: TrameBlanc;
  rehaut: { actif: boolean; /** L* à partir duquel le rehaut commence. */ seuilL: number; densitePct: number };
};

export const SOUS_COUCHE_DEFAUT: OptionsSousCouche = {
  active: false,
  mode: "auto",
  source: "encres",
  densitePct: 100,
  sansSousFoncesL: 0,
  trame: { lpi: 45, angle: 22.5, forme: "rond", pointMinPct: 5, pointMaxPct: 95 },
  rehaut: { actif: false, seuilL: 75, densitePct: 100 },
};

/** Mode réellement appliqué : l'automatique suit le rendu des couleurs. */
export const modeSousCouche = (o: OptionsSousCouche, rendu: Rendu["type"]): "aplat" | "tramee" =>
  o.mode === "auto" ? (rendu === "am" || rendu === "cmjn" ? "tramee" : "aplat") : o.mode;

/** Luminosité L* (0 à 100) d'un pixel sRVB. */
function luminosite(r: number, g: number, b: number) {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** Luminosité de chaque pixel, en 0 à 255 (L* × 2,55). */
export function luminosites(px: Uint8ClampedArray | Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const cache = new Map<number, number>();
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const cle = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let v = cache.get(cle);
    if (v === undefined) {
      v = Math.round(luminosite(px[i], px[i + 1], px[i + 2]) * 2.55);
      cache.set(cle, v);
    }
    out[p] = v;
  }
  return out;
}

export type EntreeBlancs = {
  largeur: number;
  hauteur: number;
  /** Dessin à plat (index d'encre ou HORS_DESSIN) : base de la sous-couche et du rentré. */
  plats: Uint8Array;
  /** Tons par encre (trame AM, quadrichromie) ; null = aplats. */
  tons: Uint8Array[] | null;
  /** Luminosité des pixels (0 à 255). */
  lum: Uint8Array;
  options: OptionsSousCouche;
  rendu: Rendu["type"];
  rentrePx: number;
};

/**
 * Tons (0 à 255) de la sous-couche et du rehaut, avant trame. En aplat, la
 * sous-couche vaut 255 partout où elle est posée.
 */
export function tonsBlancs(e: EntreeBlancs): { sousCouche: Uint8Array | null; rehaut: Uint8Array | null } {
  const { largeur: w, hauteur: h, plats, tons, lum, options: o } = e;
  const n = w * h;
  let sc: Uint8Array | null = null;
  if (o.active) {
    const plein = sousCouche({ largeur: w, hauteur: h, indices: plats }, e.rentrePx);
    const aplat = modeSousCouche(o, e.rendu) === "aplat";
    const seuilSombre = Math.round(o.sansSousFoncesL * 2.55);
    const densite = o.densitePct / 100;
    sc = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (!plein[p]) continue;
      if (seuilSombre > 0 && lum[p] < seuilSombre) continue;
      let t = o.source === "luminosite" ? lum[p] : tons ? tons.reduce((m, x) => (x[p] > m ? x[p] : m), 0) : 255;
      t = Math.round(t * densite);
      // Aplat : posé dès 10 % de ton, en plein.
      sc[p] = aplat ? (t >= 26 ? 255 : 0) : t;
    }
  }
  let rh: Uint8Array | null = null;
  if (o.active && o.rehaut.actif) {
    const seuil = o.rehaut.seuilL * 2.55;
    const densite = o.rehaut.densitePct / 100;
    rh = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (plats[p] === HORS_DESSIN || lum[p] <= seuil) continue;
      rh[p] = Math.round(Math.min(1, (lum[p] - seuil) / Math.max(1, 255 - seuil)) * 255 * densite);
    }
  }
  return { sousCouche: sc, rehaut: rh };
}

/** Écrans de blanc pour les films (1 = blanc déposé), à la résolution `ppp`. */
export function ecransBlancs(e: EntreeBlancs, ppp: number): { sousCouche: Uint8Array | null; rehaut: Uint8Array | null } {
  const { sousCouche: sc, rehaut: rh } = tonsBlancs(e);
  const t = e.options.trame;
  const reglage = { ppp, lpi: t.lpi, forme: t.forme, pointMinPct: t.pointMinPct, pointMaxPct: t.pointMaxPct };
  const aplat = modeSousCouche(e.options, e.rendu) === "aplat";
  return {
    sousCouche: sc ? (aplat ? sc.map((v) => (v ? 1 : 0)) : tramerAM((p) => sc[p], e.largeur, e.hauteur, { ...reglage, angle: t.angle })) : null,
    // Le rehaut est toujours tramé (dégradé de lumière), décalé de 30° de la sous-couche.
    rehaut: rh ? tramerAM((p) => rh[p], e.largeur, e.hauteur, { ...reglage, angle: t.angle + 30 }) : null,
  };
}
