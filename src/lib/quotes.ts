import { createClient } from "@/lib/supabase/server";
import { getMediaFilePreviewUrls } from "@/lib/media/preview";
import type { AttachableMediaFile, DownloadableMediaFile, QuoteLine } from "@/lib/types/domain";

/**
 * Lignes d'un devis avec leur configuration couleur résolue (couleur unique
 * « modèle uni », ou couleur par zone avec le libellé de zone attaché
 * depuis product_zone_templates) — c'est cette configuration que
 * `QuoteDetail` affiche comme « maquette » à valider (chantier
 * config-produit-devis) — et son visuel/sa maquette au sens fichier
 * (migration 0041). Partagé entre les vues commercial et client du devis,
 * comme `getSizesForProductModel` l'est entre les écrans ODF.
 */
export async function getQuoteLinesWithColorConfig(quoteId: string): Promise<QuoteLine[]> {
  const supabase = await createClient();

  const [{ data: rawLines }, { data: zoneTemplates }, { data: rawMedia }] = await Promise.all([
    supabase
      .from("quote_lines")
      .select(
        "*,couleur_unique:couleur_unique_id(id,name,code),zone_colors:quote_line_zone_colors(zone_key,colors:color_id(id,name,code)),printable_zones:quote_line_printable_zones(printable_zone_id,nb_couleurs,product_printable_zones(zone_label,display_order)),sizes:quote_line_sizes(taille,quantite)"
      )
      .eq("quote_id", quoteId),
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label"),
    // Visuel(s) et maquette (migration 0041) — jointure via quote_lines pour
    // filtrer par devis, ces deux tables n'ayant pas de quote_id en commun.
    supabase
      .from("quote_line_media_files")
      .select("quote_line_id,media_file_id,media_files(file_name,category),quote_lines!inner(quote_id)")
      .eq("quote_lines.quote_id", quoteId),
  ]);

  const labelOf = (productModelId: string | null, zoneKey: string) =>
    (zoneTemplates ?? []).find((z) => z.product_model_id === productModelId && z.zone_key === zoneKey)?.zone_label;

  const visuelsByLine = new Map<string, AttachableMediaFile[]>();
  const maquetteByLine = new Map<string, AttachableMediaFile>();
  for (const m of rawMedia ?? []) {
    const media = m.media_files as unknown as { file_name: string; category: string } | null;
    if (!media) continue;
    const file: AttachableMediaFile = { id: m.media_file_id, file_name: media.file_name, category: media.category as AttachableMediaFile["category"] };
    if (media.category === "maquette") {
      if (!maquetteByLine.has(m.quote_line_id)) maquetteByLine.set(m.quote_line_id, file);
    } else if (media.category === "visuel") {
      const list = visuelsByLine.get(m.quote_line_id) ?? [];
      list.push(file);
      visuelsByLine.set(m.quote_line_id, list);
    }
  }
  const allVisuelIds = Array.from(visuelsByLine.values()).flatMap((files) => files.map((f) => f.id));
  const [maquettePreviewUrls, visuelDownloadUrls] = await Promise.all([
    getMediaFilePreviewUrls(Array.from(maquetteByLine.values()).map((f) => f.id)),
    getMediaFilePreviewUrls(allVisuelIds),
  ]);

  return ((rawLines ?? []) as unknown as QuoteLine[]).map((l) => {
    const maquette = maquetteByLine.get(l.id);
    const visuels: DownloadableMediaFile[] = (visuelsByLine.get(l.id) ?? []).map((f) => ({
      ...f,
      downloadUrl: visuelDownloadUrls.get(f.id) ?? null,
    }));
    const printable = (l.printable_zones ?? []) as unknown as {
      printable_zone_id: string;
      nb_couleurs: number;
      product_printable_zones: { zone_label: string; display_order: number } | null;
    }[];
    return {
      ...l,
      zone_colors: (l.zone_colors ?? []).map((z) => ({ ...z, zone_label: labelOf(l.product_model_id, z.zone_key) })),
      printable_zones: printable
        .map((z) => ({
          printable_zone_id: z.printable_zone_id,
          nb_couleurs: z.nb_couleurs,
          zone_label: z.product_printable_zones?.zone_label,
          display_order: z.product_printable_zones?.display_order ?? 0,
        }))
        .sort((a, b) => a.display_order - b.display_order),
      sizes: Object.fromEntries(
        ((l.sizes ?? []) as unknown as { taille: string; quantite: number }[]).map((z) => [z.taille, z.quantite])
      ),
      visuels,
      maquette: maquette ? { ...maquette, previewUrl: maquettePreviewUrls.get(maquette.id) ?? null } : null,
    };
  });
}
