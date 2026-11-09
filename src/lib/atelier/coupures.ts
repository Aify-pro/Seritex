/** Taille des morceaux d'un sac de déchets (migration 0162). */
export const COUPURES = [
  { value: "petite", label: "Petite coupure" },
  { value: "moyenne", label: "Moyenne coupure" },
  { value: "grande", label: "Grande coupure" },
] as const;

export type Coupure = (typeof COUPURES)[number]["value"];

export function libelleCoupure(value: string | null | undefined): string | null {
  return COUPURES.find((c) => c.value === value)?.label ?? null;
}
