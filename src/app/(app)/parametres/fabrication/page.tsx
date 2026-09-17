import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { AtelierCategorie, FabricationSettings } from "@/lib/types/domain";
import { DefaultRateForm } from "./default-rate-form";
import { CategoryRateForm } from "./category-rate-form";
import { Info } from "lucide-react";

/**
 * Paramètres > Fabrication — premier réglage : taux d'acceptation du
 * surplus tracé (migration 0045), qui bloque désormais la validation d'un
 * ODF au-delà du seuil configuré (section 11 du document de logique).
 * D'autres réglages de production pourront rejoindre cette page plus tard.
 */
export default async function FabricationSettingsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: settings }, { data: categories }] = await Promise.all([
    supabase.from("fabrication_settings").select("*").limit(1).single(),
    supabase
      .from("atelier_categories")
      .select("*")
      .eq("requiert_fiche_trace", true)
      .eq("active", true)
      .order("display_order"),
  ]);

  const config = settings as FabricationSettings | null;
  const tauxDefaut = config?.taux_acceptation_surplus_defaut ?? 10;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fabrication"
        description="Réglages de production communs à tous les ordres de fabrication — aujourd'hui le taux d'acceptation du surplus tracé, qui bloque la validation d'un ODF au-delà du seuil configuré."
      />

      <Card>
        <CardHeader
          title="Taux d'acceptation du surplus tracé"
          description="Au moment de valider un ODF, si la quantité tracée dépasse la quantité demandée d'un pourcentage supérieur ou égal à ce taux (pour au moins une taille), la validation est bloquée avec un message d'erreur — aucun contournement possible depuis l'écran."
        />
        <CardBody>
          {config && <DefaultRateForm id={config.id} taux={config.taux_acceptation_surplus_defaut} />}
          {config?.updated_at && (
            <p className="mt-3 text-xs text-foreground-muted">Dernière modification : {formatDateTime(config.updated_at)}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Taux par catégorie d'atelier"
          description="Remplace le taux par défaut pour une catégorie exigeant une fiche de tracé (Coupe aujourd'hui). Laissez le champ vide pour revenir au taux par défaut."
        />
        <CardBody className="space-y-3">
          {!categories?.length && (
            <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Aucune catégorie d&apos;atelier n&apos;exige de fiche de tracé actuellement — le taux par défaut ci-dessus
              s&apos;applique donc partout où un contrôle de surplus a lieu.
            </div>
          )}
          <ul className="divide-y divide-border">
            {(categories as AtelierCategorie[] | null)?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-end justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="text-sm font-medium text-foreground">{c.nom}</span>
                <CategoryRateForm categorieId={c.id} taux={c.taux_acceptation_surplus_trace} tauxDefaut={tauxDefaut} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
