import "server-only";
import { createClient } from "@/lib/supabase/server";
import { articleSearchText, type ArticleRow } from "@/lib/articles/filters";
import type { FilterOption } from "@/lib/clients/filters";

/**
 * Lignes de la liste Articles (produits finis) et options des filtres
 * avancés. Lecture sous la RLS de l'utilisateur : la présence d'une grille
 * de prix de revient n'est connue que de la Direction et de l'administrateur
 * (A2) — pour les autres rôles, `grille` vaut null et le filtre est masqué.
 */
export interface ArticleCatalog {
  rows: ArticleRow[];
  options: {
    categories: FilterOption[];
    matieres: FilterOption[];
    grammages: FilterOption[];
    couleurs: FilterOption[];
  };
}

function countOptions(values: (string | null | undefined)[], label?: (v: string) => string): FilterOption[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, label: label?.(value) }))
    .sort((a, b) => (a.label ?? a.value).localeCompare(b.label ?? b.value, "fr"));
}

export async function loadArticleCatalog({ canSeeCosts }: { canSeeCosts: boolean }): Promise<ArticleCatalog> {
  const supabase = await createClient();
  const [{ data: models }, { data: modelColors }, { data: colors }, { data: costs }] = await Promise.all([
    supabase.from("product_models").select("id,name,category,active,sage_reference,textile_id,textiles(nom,grammage)").order("name"),
    supabase.from("product_model_colors").select("product_model_id,color_id"),
    supabase.from("colors").select("id,name").order("name"),
    canSeeCosts ? supabase.from("model_cost_components").select("product_model_id") : Promise.resolve({ data: [] }),
  ]);

  const avecGrille = new Set((costs ?? []).map((c) => c.product_model_id as string));
  const colorName = new Map((colors ?? []).map((c) => [c.id as string, c.name as string]));

  const rows: ArticleRow[] = (models ?? []).map((m) => {
    const textile = m.textiles as unknown as { nom: string; grammage: number | null } | null;
    const couleurIds = (modelColors ?? []).filter((c) => c.product_model_id === m.id).map((c) => c.color_id as string);
    return {
      id: m.id as string,
      code: null,
      name: m.name as string,
      category: (m.category as string | null) ?? null,
      active: !!m.active,
      matiere: textile?.nom ?? null,
      grammages: textile?.grammage ? [Number(textile.grammage)] : [],
      couleurIds,
      grille: canSeeCosts ? avecGrille.has(m.id as string) : null,
      sage: !!m.sage_reference,
      declinaisons: 0,
      stockDisponible: null,
      prixAPartirDe: null,
      vignetteUrl: null,
      searchText: articleSearchText([
        m.name as string,
        m.category as string | null,
        textile?.nom,
        m.sage_reference as string | null,
        ...couleurIds.map((id) => colorName.get(id)),
      ]),
    };
  });

  return {
    rows,
    options: {
      categories: countOptions(rows.map((r) => r.category)),
      matieres: countOptions(rows.map((r) => r.matiere)),
      grammages: countOptions(rows.flatMap((r) => r.grammages.map(String)), (g) => `${g} g/m²`),
      couleurs: countOptions(rows.flatMap((r) => r.couleurIds), (id) => colorName.get(id) ?? id),
    },
  };
}
