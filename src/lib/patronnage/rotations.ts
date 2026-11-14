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

/**
 * Lignes `pattern_pieces` à insérer au remplacement du DXF d'un patron, avec
 * les réglages de rotation et de symétrie repris des anciennes pièces.
 *
 * Chaque ligne renvoyée porte TOUJOURS `rotations_autorisees` et `symetrie`.
 * Raison : en insert groupé, supabase-js envoie `columns=` avec l'union des
 * clés de toutes les lignes, et PostgREST met NULL dans les colonnes absentes
 * d'une ligne (au lieu de la valeur par défaut de la base). Les deux colonnes
 * étant NOT NULL (migration 0182), un DXF qui mêle une pièce gardée et une
 * pièce nouvelle ferait échouer tout l'insert.
 *
 * Règles :
 * - une pièce qui garde son nom reprend les rotations de l'ancienne si elles
 *   forment un choix admis ({0}, {180}, {0,180}), sinon {0,180} ; et sa
 *   symétrie (normalisée) ;
 * - une pièce nouvelle ou renommée prend {0,180} et « aucune » ;
 * - si plusieurs anciennes pièces portent le même nom, la PREMIÈRE de la liste
 *   fait foi ;
 * - plusieurs nouvelles pièces du même nom reçoivent chacune les réglages de
 *   cette ancienne.
 * Fonction pure : les entrées ne sont pas modifiées, chaque ligne reçoit son
 * propre tableau de rotations.
 */
export function lignesAvecReglages<T extends { name: string }>(
  nouvelles: readonly T[],
  anciennes: readonly { name: string | null; rotations_autorisees: unknown; symetrie: unknown }[],
): (T & { rotations_autorisees: number[]; symetrie: Symetrie })[] {
  const parNom = new Map<string, (typeof anciennes)[number]>();
  for (const a of anciennes) {
    if (a.name !== null && !parNom.has(a.name)) parNom.set(a.name, a);
  }
  return nouvelles.map((row) => {
    const ancienne = parNom.get(row.name);
    if (!ancienne) return { ...row, rotations_autorisees: [...ROTATIONS_DEFAUT], symetrie: "aucune" as Symetrie };
    const rotations = normaliserRotations(ancienne.rotations_autorisees);
    return {
      ...row,
      rotations_autorisees: choixDepuisRotations(rotations) !== null ? rotations : [...ROTATIONS_DEFAUT],
      symetrie: normaliserSymetrie(ancienne.symetrie),
    };
  });
}
