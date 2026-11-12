import { z } from "zod";

/**
 * Contrat JSON `seritex.imbrication/v1` entre Seritex et le moteur
 * d'imbrication (module Rust `rust/imbrication`, compilé en WebAssembly).
 *
 * Miroir exact de `rust/imbrication/src/contrat.rs` et de la documentation
 * `docs/imbrication.md` : toute modification se fait aux trois endroits, et
 * un changement incompatible impose une nouvelle version du contrat.
 *
 * Unités : millimètres et degrés. Repère : X = longueur du tissu (sens du
 * rouleau), Y = largeur ; le tracé commence en X = 0, Y = 0 est la lisière
 * basse.
 */

export const VERSION_CONTRAT = "seritex.imbrication/v1";

const point = z.tuple([z.number().finite(), z.number().finite()]);

export const pieceSchema = z
  .object({
    /** Identifiant choisi par Seritex, renvoyé tel quel dans les placements. */
    id: z.string().min(1),
    /** Contour extérieur (mm), au moins 3 points ; trous non pris en charge. */
    contour: z.array(point).min(3),
    quantite: z.number().int().min(1),
    /** Angles autorisés (degrés), ex. [0, 180] : la pièce suit le sens du rouleau. */
    rotations: z.array(z.number().finite()).min(1),
    /**
     * Pièce posée retournée (symétrie y → -y), ex. la manche droite d'une
     * paire dont le patron est la gauche. Tous ses exemplaires sont retournés :
     * le moteur ne choisit jamais lui-même de retourner une pièce.
     */
    miroir: z.boolean().default(false),
  })
  .strict();

export const entreeSchema = z
  .object({
    version: z.literal(VERSION_CONTRAT),
    tissu: z
      .object({
        /** Largeur utile (mm), lisières retirées. */
        largeur_utile: z.number().finite().positive(),
        /** Marge supplémentaire le long de chaque lisière (mm). */
        marge_lisiere: z.number().finite().min(0).default(0),
        /** Longueur maximale de table (mm) : signalée, jamais imposée au moteur. */
        longueur_max: z.number().finite().positive().nullable().default(null),
      })
      .strict(),
    /** Distance minimale entre pièces, et entre une pièce et les bords (mm). */
    espacement: z.number().finite().min(0).default(0),
    calcul: z
      .object({
        /** Temps maximal (s), toujours respecté. */
        temps_max_s: z.number().finite().positive().max(4 * 3600),
        graine: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        /** Budget d'effort (itérations) : rend le résultat reproductible. */
        effort: z.number().int().min(1).nullable().default(null),
        /** Fichier dont l'apparition annule le calcul (géré par moteur.ts). */
        fichier_annulation: z.string().nullable().default(null),
      })
      .strict(),
    pieces: z.array(pieceSchema).min(1),
    /**
     * Reprise : le moteur repart de ces placements (meilleur tracé d'une
     * tranche précédente). Permet d'enchaîner des tranches de calcul plus
     * courtes que la durée maximale d'une fonction serveur. Absent = départ de zéro.
     */
    reprise: z.object({ placements: z.array(z.lazy(() => placementSchema)) }).strict().nullable().default(null),
  })
  .strict();

export type EntreeImbrication = z.input<typeof entreeSchema>;
export type EntreeImbricationNormalisee = z.output<typeof entreeSchema>;
export type PieceImbrication = z.output<typeof pieceSchema>;

export const placementSchema = z.object({
  piece_id: z.string(),
  /**
   * Transformation du contour d'ORIGINE, dans cet ordre : symétrie y → -y si
   * `miroir`, rotation de `rotation` degrés autour de l'origine, translation
   * de (x, y).
   */
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  miroir: z.boolean(),
});

export const sortieSchema = z.object({
  version: z.literal(VERSION_CONTRAT),
  statut: z.enum(["termine", "annule", "echec"]),
  erreur: z
    .object({ code: z.string(), message: z.string(), piece_id: z.string().optional() })
    .optional(),
  arret: z.enum(["budget_effort", "budget_temps", "temps_max", "annulation"]).optional(),
  longueur: z.number(),
  largeur_utile: z.number(),
  taux_utilisation: z.number(),
  depasse_longueur_max: z.boolean(),
  temps_calcul_s: z.number(),
  effort_utilise: z.number(),
  reproductible: z.boolean(),
  graine: z.number(),
  moteur: z.object({ nom: z.string(), version: z.string(), jagua_rs: z.string(), wrapper: z.string() }),
  placements: z.array(placementSchema),
});

export type SortieImbrication = z.output<typeof sortieSchema>;
export type PlacementImbrication = z.output<typeof placementSchema>;

export const LIBELLES_ARRET: Record<NonNullable<SortieImbrication["arret"]>, string> = {
  budget_effort: "Budget d'effort atteint (résultat reproductible)",
  budget_temps: "Temps de calcul écoulé",
  temps_max: "Temps maximal atteint",
  annulation: "Calcul annulé",
};
