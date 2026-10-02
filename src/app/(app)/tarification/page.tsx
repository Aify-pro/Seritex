import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatMoney } from "@/lib/currency";
import { priceGrid } from "@/lib/pricing";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { effectiveParams, getModelPricings, getPricingSettings, getPrintGrid } from "@/lib/tarification";
import { PricingSettingsForm, PrintCostsForm } from "./settings-forms";
import { TextilePricesForm } from "./textile-prices-form";

/**
 * Tarification (migration 0067) — Direction et administrateur uniquement.
 * Paramètres généraux, grille impression, et synthèse des grilles par modèle :
 * fourchette de prix de revient et de prix de vente, modèles sans grille.
 */
export default async function TarificationPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const [{ data: models }, settings, printGrid, { data: textiles }, { data: textilePrices }] = await Promise.all([
    supabase.from("product_models").select("id,name,category").eq("active", true).order("name"),
    getPricingSettings(),
    getPrintGrid(),
    supabase.from("textiles").select("id,nom,grammage").eq("active", true).order("nom"),
    supabase.from("textile_prices").select("textile_id,prix_kg"),
  ]);
  const ids = (models ?? []).map((m) => m.id as string);
  const [pricings, sizesByModel] = await Promise.all([getModelPricings(ids), getSizeOptionsByModel(ids)]);

  const range = (values: (number | null)[]) => {
    const v = values.filter((x): x is number => x !== null);
    if (v.length === 0) return "—";
    const min = Math.min(...v);
    const max = Math.max(...v);
    return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarification"
        description="Prix de revient et prix de vente par modèle de produit. Visible uniquement de la Direction et de l'administrateur — les commerciaux n'y ont pas accès."
        action={
          <Link href="/tarification/realise" className="text-sm font-medium text-brand hover:underline">
            Prix de revient réel des ODF →
          </Link>
        }
      />

      <Card>
        <CardHeader title="Grilles par modèle" description="Prix de l'article nu (hors impressions), toutes tailles du modèle. Les impressions s'ajoutent au chiffrage de chaque devis." />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Modèle</th>
                  <th className="px-5 py-2 font-medium">Composants</th>
                  <th className="px-5 py-2 font-medium">Prix de revient</th>
                  <th className="px-5 py-2 font-medium">Prix de vente</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(models ?? []).map((m) => {
                  const p = pricings[m.id as string];
                  const cles = (sizesByModel[m.id as string] ?? []).map((s) => s.cle);
                  const grid = p.components.length > 0 ? priceGrid(p.components, cles, effectiveParams(settings, p), { forced: p.forced }) : null;
                  return (
                    <tr key={m.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{m.name}</p>
                        {m.category && <p className="text-xs text-foreground-muted">{m.category}</p>}
                      </td>
                      <td className="px-5 py-3 text-foreground-muted">{p.components.length || <span className="text-warning">Grille à saisir</span>}</td>
                      <td className="px-5 py-3">{grid ? range(grid.sizes.map((s) => s.pr)) : "—"}</td>
                      <td className="px-5 py-3">{grid ? range(grid.sizes.map((s) => s.pv)) : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/tarification/${m.id}`} className="text-xs font-medium text-brand hover:underline">
                          {p.components.length ? "Ouvrir la grille" : "Saisir la grille"} →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Paramètres généraux" description="Valeurs par défaut de tous les modèles ; un modèle peut avoir ses propres charges et marge." />
        <CardBody>
          <PricingSettingsForm initial={settings} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Prix du tissu au kg"
          description="Prix rendu (douane comprise), par textile. Il valorise le tissu pesé dans le prix de revient réel des ODF ; un ODF peut avoir son propre prix (famille de couleur, nouveau prix fournisseur)."
        />
        <CardBody>
          <TextilePricesForm
            textiles={(textiles ?? []).map((t) => ({
              id: t.id as string,
              nom: t.nom as string,
              grammage: (t.grammage as number | null) ?? null,
              prixKg: (() => {
                const p = (textilePrices ?? []).find((x) => x.textile_id === t.id);
                return p ? Number(p.prix_kg) : null;
              })(),
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Grille impression" description="Coût par pièce d'une impression selon son nombre de couleurs (initialisée à 55 F CFA de 1 à 7 couleurs, comme la grille Excel)." />
        <CardBody>
          <PrintCostsForm initial={printGrid.coutParNbCouleurs} />
        </CardBody>
      </Card>
    </div>
  );
}
