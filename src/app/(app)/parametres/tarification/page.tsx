import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { getPricingSettings, getPrintGrid } from "@/lib/tarification";
import { PricingSettingsForm, PrintCostsForm } from "./settings-forms";
import { TextilePricesForm } from "./textile-prices-form";
import { SerigraphieForm } from "./serigraphie-form";
import { chargerParametresSerigraphie } from "@/lib/separation/encres-serveur";

/**
 * Paramétrage de la tarification (migration 0067) — Direction et
 * administrateur. La grille de chaque modèle vit dans sa fiche article
 * (onglet Prix de revient) ; le prix de revient réel, dans la fiche de l'ODF.
 */
export default async function TarificationSettingsPage() {
  await requireModule("tarification");
  const supabase = await createClient();
  const [settings, printGrid, { data: textiles }, { data: textilePrices }, serigraphie] = await Promise.all([
    getPricingSettings(),
    getPrintGrid(),
    supabase.from("textiles").select("id,nom,grammage").eq("active", true).order("nom"),
    supabase.from("textile_prices").select("textile_id,prix_kg"),
    chargerParametresSerigraphie(supabase),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarification"
        description="Valeurs communes à tous les modèles : charges, marge et coefficient, prix du tissu au kg, grille impression. La grille de chaque modèle se saisit dans sa fiche article."
      />

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

      {serigraphie && (
        <Card>
          <CardHeader
            title="Sérigraphie : prix de revient"
            description="Ce que coûte réellement une impression à l'atelier : écrans, calage, impression, séchage, gâche et encre (prix d'achat des articles encre). Sert à chiffrer un visuel dans l'outil Séparation des couleurs et à proposer la grille impression ci-dessus. Usage interne, jamais communiqué au client."
          />
          <CardBody>
            <SerigraphieForm initial={serigraphie} grilleActuelle={printGrid.coutParNbCouleurs} fraisEcranActuel={printGrid.fraisEcranParCouleur} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
