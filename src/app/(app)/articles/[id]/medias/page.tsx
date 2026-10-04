import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
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
        </CardBody>
      </Card>
    </div>
  );
}
