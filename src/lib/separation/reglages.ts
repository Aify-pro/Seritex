/**
 * Réglages avancés de l'outil Séparation des couleurs (lot 5) : moteur,
 * rendu des écrans (trame), production. Valeurs par défaut, validation et
 * lecture d'une recette enregistrée (migration 0118). Sans DOM.
 */
import { z } from "zod";
import type { OptionsSeparation } from "./separer";
import type { Rendu } from "./trame";

export type Reglages = {
  moteur: Required<Pick<OptionsSeparation, "profil" | "ecart" | "lissage" | "forcerBlanc" | "forcerNoir" | "niveauxDeGris" | "nettoyage" | "couvertureMinPct">>;
  rendu: Rendu;
  /** Résolution visée des films, points par pouce. */
  ppp: number;
  /** Plus petit îlot conservé (aplats), côté en mm. */
  pointMinMm: number;
  /** Recouvrement des encres claires sous les foncées (aplats), mm. */
  recouvrementMm: number;
  /** Rentré de la sous-couche sous les couleurs, mm. */
  rentreMm: number;
};

/** Angles AM par défaut : 22,5° pour tous les écrans (le plus sûr contre le moiré avec la maille). */
export const ANGLE_AM_DEFAUT = 22.5;

export const REGLAGES_DEFAUT: Reglages = {
  moteur: {
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
]);

export const reglagesSchema = z.object({
  moteur: z.object({
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
});

/** Lit des réglages enregistrés : complète avec les valeurs par défaut, null si invalides. */
export function lireReglages(v: unknown): Reglages | null {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Reglages>;
  const r = reglagesSchema.safeParse({
    ...REGLAGES_DEFAUT,
    ...o,
    moteur: { ...REGLAGES_DEFAUT.moteur, ...(o.moteur ?? {}) },
    rendu: o.rendu ?? REGLAGES_DEFAUT.rendu,
  });
  return r.success ? (r.data as Reglages) : null;
}
