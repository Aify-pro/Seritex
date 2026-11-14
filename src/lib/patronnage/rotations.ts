import { z } from "zod";

/**
 * Rotations autorisées et symétrie d'une pièce de patron
 * (`pattern_pieces.rotations_autorisees` numeric[] et `pattern_pieces.symetrie`,
 * migration 0182). Le moteur d'imbrication les lit ; elles se règlent par pièce
 * dans la bibliothèque. Seules trois combinaisons sont admises : la base
 * accepterait d'autres angles (contrainte 0 ≤ a < 360), l'application non.
 */

export type ChoixRotation = "0" | "180" | "0_180";
export type Symetrie = "aucune" | "paire";

export const CHOIX_ROTATION: { valeur: ChoixRotation; libelle: string; angles: readonly number[] }[] = [
  { valeur: "0_180", libelle: "0° et 180°", angles: [0, 180] },
  { valeur: "0", libelle: "0° seulement", angles: [0] },
  { valeur: "180", libelle: "180° seulement", angles: [180] },
];

export const CHOIX_SYMETRIE: { valeur: Symetrie; libelle: string }[] = [
  { valeur: "aucune", libelle: "Aucune" },
  { valeur: "paire", libelle: "Paire" },
];

export const ROTATIONS_DEFAUT: readonly number[] = [0, 180];

/**
 * Normalise la valeur lue en base : PostgREST peut renvoyer un numeric[] sous
 * forme de nombres ou de chaînes (« 0 », « 180.0 »). Renvoie les angles triés,
 * sans doublon ; tableau vide si rien d'exploitable.
 */
export function normaliserRotations(brut: unknown): number[] {
  if (!Array.isArray(brut)) return [];
  const angles = brut
    .map((v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n));
  return [...new Set(angles)].sort((a, b) => a - b);
}

/** Choix d'interface correspondant aux angles, ou null si la base contient une autre combinaison. */
export function choixDepuisRotations(angles: readonly number[]): ChoixRotation | null {
  const cle = [...angles].sort((a, b) => a - b).join(",");
  return CHOIX_ROTATION.find((c) => c.angles.join(",") === cle)?.valeur ?? null;
}

export function libelleRotations(angles: readonly number[]): string {
  const choix = choixDepuisRotations(angles);
  if (choix) return CHOIX_ROTATION.find((c) => c.valeur === choix)!.libelle;
  return angles.length > 0 ? angles.map((a) => `${a}°`).join(", ") : "non renseignées";
}

export function normaliserSymetrie(brut: unknown): Symetrie {
  return brut === "paire" ? "paire" : "aucune";
}

/**
 * Schéma de la Server Action : les angles sont comparés en ensemble trié et
 * doivent être exactement {0}, {180} ou {0,180}. Tout le reste (vide, 90, 360,
 * doublons, non entiers, chaînes) est refusé.
 */
export const reglageRotationsSchema = z.object({
  pieceId: z.uuid({ error: "Pièce inconnue" }),
  rotations: z
    .array(z.number({ error: "Angle invalide" }), { error: "Rotations invalides" })
    .refine((a) => new Set(a).size === a.length, { error: "Un même angle est indiqué deux fois" })
    .refine((a) => choixDepuisRotations(a) !== null, {
      error: "Rotations autorisées : « 0° seulement », « 180° seulement » ou « 0° et 180° »",
    })
    .transform((a) => [...a].sort((x, y) => x - y)),
  symetrie: z.enum(["aucune", "paire"], { error: "Symétrie : « aucune » ou « paire »" }),
});

export type ReglageRotations = z.input<typeof reglageRotationsSchema>;
