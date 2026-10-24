import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { getPricingSettings, getPrintGrid } from "@/lib/tarification";
import { PricingSettingsForm, PrintCostsForm } from "./settings-forms";
import { SerigraphieForm } from "./serigraphie-form";
import { chargerParametresSerigraphie } from "@/lib/separation/encres-serveur";

/**
 * Paramétrage de la tarification (migration 0067) — Direction et
 * administrateur. La grille de chaque modèle vit dans sa fiche article
 * (onglet Prix de revient), comme le prix d'achat au kg d'un tissu (migration
 * 0141) ; le prix de revient réel, dans la fiche de l'ODF.
 */
export default async function TarificationSettingsPage() {
  await requireModule("tarification");
  const supabase = await createClient();
  const [settings, printGrid, serigraphie] = await Promise.all([getPricingSettings(), getPrintGrid(), chargerParametresSerigraphie(supabase)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarification"
        description="Valeurs communes à tous les modèles : charges, marge et coefficient, grille impression. La grille de chaque modèle se saisit dans sa fiche article, le prix d'achat au kg d'un tissu dans la fiche de l'article tissu."
      />

      <Card>
        <CardHeader title="Paramètres généraux" description="Valeurs par défaut de tous les modèles ; un modèle peut avoir ses propres charges et marge." />
        <CardBody>
          <PricingSettingsForm initial={settings} />
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
