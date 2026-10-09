/**
 * Réglages avancés de l'outil Séparation des couleurs (lot 5) : moteur,
 * rendu des écrans (trame), production. Valeurs par défaut, validation et
 * lecture d'une recette enregistrée (migration 0118). Sans DOM.
 */
import { z } from "zod";
import type { OptionsSeparation } from "./separer";
import type { Rendu } from "./trame";
import { IMAGE_NEUTRE, type ReglagesImage } from "./image";
import { nettoyerExpert, type ValeursExpert } from "./expert";
import { SOUS_COUCHE_DEFAUT, type OptionsSousCouche } from "./sous-couche";

export type Reglages = {
  /** Réglages manuels de l'image, appliqués avant la séparation (lot 7). */
  image: ReglagesImage;
  moteur: Required<Pick<OptionsSeparation, "profil" | "ecart" | "lissage" | "forcerBlanc" | "forcerNoir" | "niveauxDeGris" | "nettoyage" | "couvertureMinPct">> & {
    /** Paramètres experts du moteur ; absent = valeur du profil. */
    expert: ValeursExpert;
  };
  rendu: Rendu;
  /** Résolution visée des films, points par pouce. */
  ppp: number;
  /** Plus petit îlot conservé (aplats), côté en mm. */
  pointMinMm: number;
  /** Recouvrement des encres claires sous les foncées (aplats), mm. */
  recouvrementMm: number;
  /** Rentré de la sous-couche sous les couleurs, mm. */
  rentreMm: number;
  /** Blancs des textiles foncés : sous-couche et rehaut. */
  blancs: OptionsSousCouche;
};

/** Angles AM par défaut : 22,5° pour tous les écrans (le plus sûr contre le moiré avec la maille). */
export const ANGLE_AM_DEFAUT = 22.5;

export const REGLAGES_DEFAUT: Reglages = {
  image: IMAGE_NEUTRE,
  moteur: {
    expert: {},
    profil: "auto",
    ecart: "cie76",
    lissage: "leger",
    forcerBlanc: false,
    forcerNoir: false,
    niveauxDeGris: false,
    nettoyage: true,
    couvertureMinPct: 0.5,
  },
  rendu: { type: "aplat" },
  ppp: 360,
  pointMinMm: 0.5,
  recouvrementMm: 0,
  rentreMm: 0.2,
  blancs: SOUS_COUCHE_DEFAUT,
};

/** Quadrichromie proposée : angles classiques C 15°, M 75°, J 0°, N 45°. */
export const CMJN_DEFAUT: Extract<Rendu, { type: "cmjn" }> = {
  type: "cmjn",
  lpi: 45,
  angles: [15, 75, 0, 45],
  forme: "elliptique",
  gcrPct: 60,
  limiteEncragePct: 260,
  engraissementPct: 10,
  pointMinPct: 5,
  pointMaxPct: 95,
};

/** Réglages AM proposés quand on choisit la trame classique. */
export const AM_DEFAUT: Extract<Rendu, { type: "am" }> = {
  type: "am",
  lpi: 45,
  angles: [ANGLE_AM_DEFAUT],
  forme: "rond",
  pointMinPct: 5,
  pointMaxPct: 95,
};

const renduSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("aplat") }),
  z.object({ type: z.literal("diffusion"), algo: z.enum(["floyd-steinberg", "atkinson", "stucki"]) }),
  z.object({ type: z.literal("bayer"), maillage: z.number().min(10).max(200) }),
  z.object({
    type: z.literal("am"),
    lpi: z.number().min(10).max(150),
    angles: z.array(z.number().min(-90).max(180)).min(1).max(13),
    forme: z.enum(["rond", "elliptique", "ligne"]),
    pointMinPct: z.number().min(0).max(50),
    pointMaxPct: z.number().min(50).max(100),
  }),
  z.object({
    type: z.literal("cmjn"),
    lpi: z.number().min(10).max(150),
    angles: z.tuple([z.number().min(-90).max(180), z.number().min(-90).max(180), z.number().min(-90).max(180), z.number().min(-90).max(180)]),
    forme: z.enum(["rond", "elliptique", "ligne"]),
    gcrPct: z.number().min(0).max(100),
    limiteEncragePct: z.number().min(100).max(400),
    engraissementPct: z.number().min(0).max(40),
    pointMinPct: z.number().min(0).max(50),
    pointMaxPct: z.number().min(50).max(100),
  }),
]);

const imageSchema = z.object({
  luminosite: z.number().min(-100).max(100),
  contraste: z.number().min(-100).max(100),
  saturation: z.number().min(-100).max(100),
  gamma: z.number().min(0.2).max(3),
  noir: z.number().min(0).max(254),
  blanc: z.number().min(1).max(255),
  teinte: z.number().min(-180).max(180),
  nettete: z.number().min(0).max(200),
  bruit: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  inverser: z.boolean(),
});

const trameBlancSchema = z.object({
  lpi: z.number().min(10).max(150),
  angle: z.number().min(-90).max(180),
  forme: z.enum(["rond", "elliptique", "ligne"]),
  pointMinPct: z.number().min(0).max(50),
  pointMaxPct: z.number().min(50).max(100),
});

const blancsSchema = z.object({
  active: z.boolean(),
  mode: z.enum(["auto", "aplat", "tramee"]),
  source: z.enum(["encres", "luminosite"]),
  densitePct: z.number().min(0).max(100),
  sansSousFoncesL: z.number().min(0).max(100),
  trame: trameBlancSchema,
  rehaut: z.object({ actif: z.boolean(), seuilL: z.number().min(30).max(99), densitePct: z.number().min(0).max(100) }),
});

export const reglagesSchema = z.object({
  image: imageSchema,
  moteur: z.object({
    expert: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    profil: z.string().min(1).max(40),
    ecart: z.enum(["cie76", "cie94", "cie2000"]),
    lissage: z.enum(["off", "leger", "fort"]),
    forcerBlanc: z.boolean(),
    forcerNoir: z.boolean(),
    niveauxDeGris: z.boolean(),
    nettoyage: z.boolean(),
    couvertureMinPct: z.number().min(0).max(10),
  }),
  rendu: renduSchema,
  ppp: z.number().min(150).max(1200),
  pointMinMm: z.number().min(0).max(5),
  recouvrementMm: z.number().min(0).max(2),
  rentreMm: z.number().min(0).max(2),
  blancs: blancsSchema,
});

/** Lit des réglages enregistrés : complète avec les valeurs par défaut, null si invalides. */
export function lireReglages(v: unknown): Reglages | null {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Reglages>;
  const r = reglagesSchema.safeParse({
    ...REGLAGES_DEFAUT,
    ...o,
    image: { ...IMAGE_NEUTRE, ...(o.image ?? {}) },
    moteur: { ...REGLAGES_DEFAUT.moteur, ...(o.moteur ?? {}), expert: nettoyerExpert(o.moteur?.expert) },
    rendu: o.rendu ?? REGLAGES_DEFAUT.rendu,
    blancs: {
      ...SOUS_COUCHE_DEFAUT,
      ...(o.blancs ?? {}),
      trame: { ...SOUS_COUCHE_DEFAUT.trame, ...(o.blancs?.trame ?? {}) },
      rehaut: { ...SOUS_COUCHE_DEFAUT.rehaut, ...(o.blancs?.rehaut ?? {}) },
    },
  });
  return r.success ? (r.data as Reglages) : null;
}
