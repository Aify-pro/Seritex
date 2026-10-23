/**
 * L'API plafonne chaque réponse à 1 000 lignes : une requête sans pagination
 * est tronquée en silence (ex. un article à plus de 1 000 déclinaisons).
 * `fetchAll` enchaîne les pages jusqu'à la dernière.
 *
 * La requête doit porter un tri total (`.order("id")` au moins) : sans lui,
 * deux pages successives peuvent se chevaucher ou laisser des lignes de côté.
 */
const PAGE = 1000;
const MAX_PAGES = 100;
// Pages demandées en même temps : au-delà de 1 000 lignes, les pages ne s'enchaînent plus une à une.
const PARALLEL = 4;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i += PARALLEL) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(PARALLEL, MAX_PAGES - i) }, (_, k) => page((i + k) * PAGE, (i + k + 1) * PAGE - 1)),
    );
    // Lecture dans l'ordre des pages ; on s'arrête à la première erreur ou page incomplète.
    for (const { data, error } of batch) {
      if (error) return { data: rows, error };
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return { data: rows, error: null };
    }
  }
  return { data: rows, error: null };
}
