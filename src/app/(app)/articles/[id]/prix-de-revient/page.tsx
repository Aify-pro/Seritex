import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { getModelPricings, getPricingSettings } from "@/lib/tarification";
import { ModelPricingEditor, type FabricOption } from "../_components/model-pricing-editor";

/**
 * Onglet Prix de revient (ART-C) : l'éditeur de la Tarification, déplacé ici.
 * Direction et administrateur seulement (A2) — garanti par la RLS des tables
 * de coût ; l'onglet n'est même pas proposé aux autres rôles.
 */
export default async function ArticleCostPage({ params }: { params: Promise<{ id: string }> }) {
  const { canSeeCosts } = await requireArticles();
  const { id } = await params;
  if (!canSeeCosts) redirect(`/articles/${id}/general`);
  const supabase = await createClient();

  const [settings, pricings, sizesByModel, { data: allowed }, { data: areas }] = await Promise.all([
    getPricingSettings(),
    getModelPricings([id]),
    getSizeOptionsByModel([id]),
    supabase.from("product_model_textiles").select("textile_id,textiles(id,nom,grammage)").eq("product_model_id", id),
    supabase.from("model_size_fabric_area").select("taille,surface_m2").eq("product_model_id", id),
  ]);
  const pricing = pricings[id];
  const textileIds = (allowed ?? []).map((a) => a.textile_id as string);
  const { data: prices } = textileIds.length
    ? await supabase.from("textile_prices").select("textile_id,prix_kg").in("textile_id", textileIds)
    : { data: [] };
  const fabrics: FabricOption[] = (allowed ?? [])
    .map((a) => a.textiles as unknown as { id: string; nom: string; grammage: number | null } | null)
    .filter((t): t is { id: string; nom: string; grammage: number | null } => !!t)
    .sort((a, b) => (a.grammage ?? 0) - (b.grammage ?? 0))
    .map((t) => ({
      id: t.id,
      nom: t.nom,
      grammage: t.grammage != null ? Number(t.grammage) : null,
      prixKg: (() => {
        const p = (prices ?? []).find((x) => x.textile_id === t.id);
        return p ? Number(p.prix_kg) : null;
      })(),
    }));

  return (
    <Card>
      <CardHeader
        title="Prix de revient"
        description={pricing.updatedAt ? `Dernière modification : ${formatDateTime(pricing.updatedAt)}` : "Aucune grille enregistrée pour ce modèle."}
      />
      <CardBody>
        <ModelPricingEditor
          productModelId={id}
          sizes={(sizesByModel[id] ?? []).map((s) => ({ cle: s.cle, libelle: s.libelle, groupe: s.groupe }))}
          defaults={{ chargesPct: settings.chargesPct, margePct: settings.margePct, arrondi: settings.arrondi }}
          initial={pricing}
          fabrics={fabrics}
          initialSurfaces={Object.fromEntries((areas ?? []).map((a) => [a.taille as string, Number(a.surface_m2)]))}
        />
      </CardBody>
    </Card>
  );
}
