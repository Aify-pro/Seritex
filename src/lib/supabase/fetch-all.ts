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

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { data: rows, error: null };
}
