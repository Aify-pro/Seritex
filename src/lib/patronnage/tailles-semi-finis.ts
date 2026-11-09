import type { createClient } from "@/lib/supabase/server";
import type { Size } from "@/lib/sizes";

export interface TailleSemiFini {
  cle: string;
  groupe: string;
  libelle: string;
  depose: boolean;
}

/**
 * Tailles à couvrir pour chaque semi-fini : celles des produits finis dont la
 * nomenclature l'emploie (tailles retenues et déclinaisons actives), plus
 * celles déjà déposées, dans l'ordre du référentiel.
 */
export async function taillesDesSemiFinis(
  supabase: Awaited<ReturnType<typeof createClient>>,
  semiFinis: { id: string; deposees: string[] }[],
  referentiel: Size[]
): Promise<Map<string, TailleSemiFini[]>> {
  const resultat = new Map<string, TailleSemiFini[]>();
  if (semiFinis.length === 0) return resultat;
  const { data: lignes } = await supabase.from("nomenclature_lines").select("semi_fini_id,product_model_id").in("semi_fini_id", semiFinis.map((s) => s.id));
  const modeles = [...new Set((lignes ?? []).map((l) => l.product_model_id as string))];
  const [{ data: retenues }, { data: variantes }] = modeles.length
    ? await Promise.all([
        supabase.from("product_model_sizes").select("product_model_id,size_id").in("product_model_id", modeles),
        supabase.from("product_variants").select("model_id,size_id").eq("actif", true).in("model_id", modeles),
      ])
    : [{ data: [] }, { data: [] }];
  for (const sf of semiFinis) {
    const modelesDuSf = new Set((lignes ?? []).filter((l) => l.semi_fini_id === sf.id).map((l) => l.product_model_id as string));
    const ids = new Set([
      ...(retenues ?? []).filter((r) => modelesDuSf.has(r.product_model_id as string)).map((r) => r.size_id as string),
      ...(variantes ?? []).filter((v) => modelesDuSf.has(v.model_id as string)).map((v) => v.size_id as string),
    ]);
    resultat.set(
      sf.id,
      referentiel
        .filter((t) => ids.has(t.id) || sf.deposees.includes(t.cle))
        .map((t) => ({ cle: t.cle, groupe: t.groupe, libelle: t.libelle, depose: sf.deposees.includes(t.cle) }))
    );
  }
  return resultat;
}
