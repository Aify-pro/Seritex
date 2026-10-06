import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { getModelPricings, getPricingSettings } from "@/lib/tarification";
import { ModelPricingEditor, type FabricOption } from "../_components/model-pricing-editor";
import { PurchasedPricingEditor } from "../_components/purchased-pricing-editor";
import { UNITE_LABELS, type Unite } from "@/lib/articles/natures";

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

  // Tissu ou consommable : prix d'achat + frais × coefficient, ou prix saisi (migration 0104).
  const { data: article } = await supabase.from("product_models").select("nature,unite").eq("id", id).maybeSingle();
  if (article && article.nature !== "pf") {
    const [settingsP, { data: mp }, { data: variants }] = await Promise.all([
      getPricingSettings(),
      supabase.from("model_pricing").select("mode_prix,prix_achat,frais_pct,prix_vente,charges_pct,marge_pct").eq("product_model_id", id).maybeSingle(),
      supabase
        .from("product_variants")
        .select("id,code,textiles(grammage),colors(name),article_dimensions(libelle),variant_pricing(mode_prix,prix_achat,frais_pct,prix_vente)")
        .eq("model_id", id)
        .eq("actif", true)
        .order("code"),
    ]);
    const n = (v: unknown) => (v == null ? null : Number(v));
    return (
      <Card>
        <CardHeader title="Prix de revient et prix de vente" description="Direction seulement. Le commercial ne voit que les prix de vente (onglet Ventes)." />
        <CardBody>
          <PurchasedPricingEditor
            productModelId={id}
            unite={UNITE_LABELS[(article.unite as Unite) ?? "piece"] ?? "unité"}
            defaults={{ chargesPct: settingsP.chargesPct, margePct: settingsP.margePct, arrondi: settingsP.arrondi, coefPrixVente: settingsP.coefPrixVente ?? null }}
            initial={{
              mode: ((mp?.mode_prix as string | undefined) ?? "calcule") as "calcule" | "saisi",
              prixAchat: n(mp?.prix_achat),
              fraisPct: n(mp?.frais_pct) ?? 0,
              prixVente: n(mp?.prix_vente),
              chargesPct: n(mp?.charges_pct),
              margePct: n(mp?.marge_pct),
            }}
            variants={(variants ?? []).map((v) => {
              const vp = (Array.isArray(v.variant_pricing) ? v.variant_pricing[0] : v.variant_pricing) as
                | { mode_prix: string | null; prix_achat: number | null; frais_pct: number | null; prix_vente: number | null }
                | null
                | undefined;
              const g = (v.textiles as unknown as { grammage: number | null } | null)?.grammage;
              return {
                id: v.id as string,
                code: v.code as string,
                label: [g ? `${g} g/m²` : null, (v.article_dimensions as unknown as { libelle: string } | null)?.libelle, (v.colors as unknown as { name: string } | null)?.name]
                  .filter(Boolean)
                  .join(" · "),
                mode: (vp?.mode_prix as "calcule" | "saisi" | null | undefined) ?? null,
                prixAchat: n(vp?.prix_achat),
                fraisPct: n(vp?.frais_pct),
                prixVente: n(vp?.prix_vente),
              };
            })}
          />
        </CardBody>
      </Card>
    );
  }

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
