import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ALERT_RULE_FIELDS } from "@/lib/vehicules/alert-rule-fields";
import { RuleForm } from "./rule-form";

/**
 * Paramètres > Logistique > Alertes (VEH-8) : chaque règle s'allume ou
 * s'éteint, porte ses seuils, sa gravité et les véhicules concernés. Les
 * règles sont évaluées à chaque synchronisation FreeTrack.
 */
export default async function AlertRulesPage() {
  await requireModule("parametres_vehicules");
  const canModify = await can("parametres_vehicules", "modify");
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle_alert_rules").select("code,libelle,description,actif,gravite,parametres,usages").order("ordre");
  const rules = (data ?? []) as {
    code: string;
    libelle: string;
    description: string | null;
    actif: boolean;
    gravite: string;
    parametres: Record<string, unknown>;
    usages: string[];
  }[];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes GPS"
        description="Calculées par Seritex à partir de FreeTrack, à chaque synchronisation. Elles apparaissent dans Logistique > Véhicules > Alertes. Les échéances de documents et d'entretien se règlent dans l'onglet Véhicules."
      />
      <Card>
        <div className="divide-y divide-border">
          {rules.map((r) => (
            <RuleForm key={r.code} rule={r} fields={ALERT_RULE_FIELDS[r.code] ?? []} canModify={canModify} />
          ))}
        </div>
      </Card>
      <p className="text-xs text-foreground-muted">
        Heures à l&apos;heure d&apos;Abidjan. Les lieux connus de « Arrêt prolongé » sont le dépôt, les lieux de livraison des clients et les stations
        géolocalisées. Le ralenti nécessite que le traceur détecte le moteur : sur les traceurs actuels, l&apos;état moteur n&apos;est pas fiable.
      </p>
    </div>
  );
}
