import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { getArticleAvailability, summarizeArticle, ESHOP_UNAVAILABLE_MESSAGE } from "@/lib/articles/availability";
import { Badge } from "@/components/ui/badge";
import { EshopForm, MediaGallery } from "./media-gallery";

/** Onglet Médias & e-shop (ART-F) : galerie par couleur, image principale, texte commercial. */
export default async function ArticleMediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: media }, { data: model }, { data: modelColors }] = await Promise.all([
    supabase.from("product_model_media").select("id,path,file_name,color_id,principale").eq("product_model_id", id).order("ordre"),
    supabase.from("product_models").select("texte_commercial,publiable_eshop").eq("id", id).maybeSingle(),
    supabase.from("product_model_colors").select("colors(id,name)").eq("product_model_id", id),
  ]);
  const availability = await getArticleAvailability([id]);
  const summary = summarizeArticle(availability);
  const missing = availability.filter((r) => r.statut === "indisponible");
  const paths = (media ?? []).map((m) => m.path as string);
  const signed = paths.length ? ((await createAdminClient().storage.from("articles").createSignedUrls(paths, 3600)).data ?? []) : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Médias" description="Photos du modèle, par couleur. L'image principale « toutes couleurs » (sinon la première principale) sert de vignette dans la liste." />
        <CardBody>
          <MediaGallery
            modelId={id}
            canModify={canModify}
            colors={(modelColors ?? [])
              .map((c) => c.colors as unknown as { id: string; name: string } | null)
              .filter((c): c is { id: string; name: string } => !!c)}
            items={(media ?? []).map((m) => ({
              id: m.id as string,
              url: signed.find((s) => s.path === m.path)?.signedUrl ?? null,
              fileName: m.file_name as string,
              colorId: (m.color_id as string | null) ?? null,
              principale: !!m.principale,
            }))}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="E-shop" description="Texte commercial et publication — préparation de l'e-shop, rien n'est publié automatiquement." />
        <CardBody>
          <EshopForm modelId={id} texte={(model?.texte_commercial as string | null) ?? null} publiable={!!model?.publiable_eshop} canModify={canModify} />
          <div className="mt-4 space-y-1 rounded-md bg-surface-muted/60 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
              Ce qui sera visible sur le site
              {!model?.publiable_eshop ? (
                <Badge tone="neutral">Non publié</Badge>
              ) : summary === "indisponible" ? (
                <Badge tone="danger">Non proposé : aucune couleur disponible</Badge>
              ) : summary === "partiel" ? (
                <Badge tone="warning">Publié sans les couleurs indisponibles</Badge>
              ) : summary === "disponible" ? (
                <Badge tone="success">Publié, toutes couleurs disponibles</Badge>
              ) : (
                <Badge tone="neutral">Publié, disponibilité non suivie</Badge>
              )}
            </p>
            {model?.publiable_eshop && missing.length > 0 && (
              <p className="text-xs text-foreground-muted">
                Retirées du site : {missing.map((r) => `${r.grammage != null ? `${r.grammage} g/m² · ` : ""}${r.color_name}`).join(", ")}. Mention affichée : « {ESHOP_UNAVAILABLE_MESSAGE} »
              </p>
            )}
            <p className="text-xs text-foreground-muted">
              Le site ne propose que ce qui est disponible d&apos;après le stock de tissu. Les devis, eux, restent possibles.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
