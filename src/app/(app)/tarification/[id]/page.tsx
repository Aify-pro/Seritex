import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { getModelPricings, getPricingSettings } from "@/lib/tarification";
import { ModelPricingEditor } from "./model-pricing-editor";

/** Grille de prix d'un modèle (migration 0067) — Direction et administrateur uniquement. */
export default async function ModelPricingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["administrateur"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: model } = await supabase.from("product_models").select("id,name,category").eq("id", id).maybeSingle();
  if (!model) notFound();

  const [settings, pricings, sizesByModel] = await Promise.all([getPricingSettings(), getModelPricings([id]), getSizeOptionsByModel([id])]);
  const pricing = pricings[id];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Tarification — ${model.name}`}
        description={
          pricing.updatedAt ? `Dernière modification : ${formatDateTime(pricing.updatedAt)}` : "Aucune grille enregistrée pour ce modèle."
        }
        action={
          <Link href="/tarification" className="text-sm text-brand hover:underline">
            ← Tous les modèles
          </Link>
        }
      />
      <Card>
        <CardBody>
          <ModelPricingEditor
            productModelId={id}
            sizes={(sizesByModel[id] ?? []).map((s) => ({ cle: s.cle, libelle: s.libelle, groupe: s.groupe }))}
            defaults={{ chargesPct: settings.chargesPct, margePct: settings.margePct, arrondi: settings.arrondi }}
            initial={pricing}
          />
        </CardBody>
      </Card>
    </div>
  );
}
