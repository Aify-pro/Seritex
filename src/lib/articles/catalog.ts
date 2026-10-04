import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const [{ data: models }, { data: modelColors }, { data: colors }, { data: costs }, { data: variants }, { data: allowed }, { data: figures }] = await Promise.all([
    supabase
      .from("product_models")
      .select("id,code,name,category,active,sage_reference,textile_id,textiles!product_models_textile_id_fkey(nom,grammage),matieres(nom)")
      .order("name"),
    supabase.from("product_model_colors").select("product_model_id,color_id"),
    supabase.from("colors").select("id,name").order("name"),
    canSeeCosts ? supabase.from("model_cost_components").select("product_model_id") : Promise.resolve({ data: [] }),
    supabase.from("product_variants").select("model_id,actif,sage_reference,variant_stock_articles(sage_reference)"),
    supabase.from("product_model_textiles").select("product_model_id,textiles(grammage)"),
    // ART-E (migration 0084) : stock disponible vierge et plus petit prix de vente, sans aucun coût.
    supabase.rpc("article_catalog_figures"),
  ]);
  // Vignette (ART-F) : image principale « toutes couleurs », sinon la première principale.
  const { data: principals } = await supabase
    .from("product_model_media")
    .select("product_model_id,path,color_id")
    .eq("principale", true)
    .order("ordre");
  const vignettePath = new Map<string, string>();
  for (const p of principals ?? []) {
    const cur = vignettePath.get(p.product_model_id as string);
    if (!cur || p.color_id === null) vignettePath.set(p.product_model_id as string, p.path as string);
  }
  const signedVignettes = vignettePath.size
    ? ((await createAdminClient().storage.from("articles").createSignedUrls([...vignettePath.values()], 3600)).data ?? [])
    : [];
  const vignetteUrl = (modelId: string) => {
    const path = vignettePath.get(modelId);
    return path ? signedVignettes.find((s) => s.path === path)?.signedUrl ?? null : null;
  };
  const figuresByModel = new Map(
    ((figures ?? []) as { product_model_id: string; stock_disponible: number | null; prix_a_partir_de: number | null }[]).map((f) => [f.product_model_id, f])
  );
  const variantsByModel = new Map<string, { actif: boolean; sage: boolean }[]>();
  for (const v of variants ?? []) {
    const sage = !!v.sage_reference || ((v.variant_stock_articles ?? []) as { sage_reference: string | null }[]).some((a) => !!a.sage_reference);
    variantsByModel.set(v.model_id as string, [...(variantsByModel.get(v.model_id as string) ?? []), { actif: !!v.actif, sage }]);
  }

  const avecGrille = new Set((costs ?? []).map((c) => c.product_model_id as string));
  const colorName = new Map((colors ?? []).map((c) => [c.id as string, c.name as string]));

  const rows: ArticleRow[] = (models ?? []).map((m) => {
    const textile = m.textiles as unknown as { nom: string; grammage: number | null } | null;
    const matiere = (m.matieres as unknown as { nom: string } | null)?.nom ?? null;
    const modelVariants = variantsByModel.get(m.id as string) ?? [];
    const grammages = [
      ...new Set(
        (allowed ?? [])
          .filter((a) => a.product_model_id === m.id)
          .map((a) => Number((a.textiles as unknown as { grammage: number | null } | null)?.grammage ?? 0))
          .filter((g) => g > 0)
      ),
    ];
    const couleurIds = (modelColors ?? []).filter((c) => c.product_model_id === m.id).map((c) => c.color_id as string);
    return {
      id: m.id as string,
      code: (m.code as string | null) ?? null,
      name: m.name as string,
      category: (m.category as string | null) ?? null,
      active: !!m.active,
      matiere: matiere ?? textile?.nom ?? null,
      grammages: grammages.length ? grammages : textile?.grammage ? [Number(textile.grammage)] : [],
      couleurIds,
      grille: canSeeCosts ? avecGrille.has(m.id as string) : null,
      sage: !!m.sage_reference || modelVariants.some((v) => v.sage),
      declinaisons: modelVariants.filter((v) => v.actif).length,
      stockDisponible: figuresByModel.get(m.id as string)?.stock_disponible != null ? Number(figuresByModel.get(m.id as string)!.stock_disponible) : null,
      prixAPartirDe: figuresByModel.get(m.id as string)?.prix_a_partir_de != null ? Number(figuresByModel.get(m.id as string)!.prix_a_partir_de) : null,
      vignetteUrl: vignetteUrl(m.id as string),
      searchText: articleSearchText([
        m.name as string,
        m.code as string | null,
        m.category as string | null,
        matiere,
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
