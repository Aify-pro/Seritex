import { createClient } from "@/lib/supabase/server";
import type { QuoteLine } from "@/lib/types/domain";

/**
 * Lignes d'un devis avec leur configuration couleur résolue (couleur unique
 * « modèle uni », ou couleur par zone avec le libellé de zone attaché
 * depuis product_zone_templates) — c'est cette configuration que
 * `QuoteDetail` affiche comme « maquette » à valider (chantier
 * config-produit-devis). Partagé entre les vues commercial et client du
 * devis, comme `getSizesForProductModel` l'est entre les écrans ODF.
 */
export async function getQuoteLinesWithColorConfig(quoteId: string): Promise<QuoteLine[]> {
  const supabase = await createClient();

  const [{ data: rawLines }, { data: zoneTemplates }] = await Promise.all([
    supabase
      .from("quote_lines")
      .select(
        "*,couleur_unique:couleur_unique_id(id,name,code),zone_colors:quote_line_zone_colors(zone_key,colors:color_id(id,name,code))"
      )
      .eq("quote_id", quoteId),
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label"),
  ]);

  const labelOf = (productModelId: string | null, zoneKey: string) =>
    (zoneTemplates ?? []).find((z) => z.product_model_id === productModelId && z.zone_key === zoneKey)?.zone_label;

  return ((rawLines ?? []) as unknown as QuoteLine[]).map((l) => ({
    ...l,
    zone_colors: (l.zone_colors ?? []).map((z) => ({ ...z, zone_label: labelOf(l.product_model_id, z.zone_key) })),
  }));
}
