import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { formatAmount, formatDate } from "@/lib/utils";
import {
  DocumentTypeForm,
  FuelPriceForm,
  FuelSettingsForm,
  ServiceTypeForm,
  StationForm,
  type DocumentTypeRow,
  type ServiceTypeRow,
  type StationRow,
} from "./settings-forms";

/**
 * Paramètres > Logistique > Véhicules : ce qui règle le module Véhicules.
 * La connexion FreeTrack et les alertes GPS ont leurs onglets voisins
 * (Géolocalisation, Alertes GPS).
 */
export default async function VehiculesSettingsPage() {
  await requireModule("parametres_vehicules");
  const supabase = await createClient();
  const [{ data: docTypes }, { data: serviceTypes }, { data: reglages }, { data: prices }, { data: stations }] = await Promise.all([
    supabase.from("vehicle_document_types").select("id,libelle,bloquant,obligatoire,preavis_jours,urgence_jours,actif").order("ordre").order("libelle"),
    supabase.from("vehicle_service_types").select("id,libelle,intervalle_jours,intervalle_km,actif").order("ordre").order("libelle"),
    supabase.from("vehicules_reglages").select("plafond_bon,ecart_consommation_pct,ecart_prix_pct,ecart_km_gps_pct,distance_station_max_m").maybeSingle(),
    supabase.from("fuel_prices").select("id,energie,prix_litre,depuis").order("depuis", { ascending: false }).limit(12),
    supabase.from("fuel_stations").select("id,nom,adresse,latitude,longitude,actif").order("nom"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Véhicules" description="Documents à suivre, entretien périodique et carburant. Les véhicules eux-mêmes se gèrent dans Logistique > Véhicules." />

      <Card>
        <CardHeader
          title="Documents des véhicules"
          description="Bloquant : une fois expiré, le document immobilise le véhicule (ni tournée, ni bon de carburant). Non bloquant : simple alerte. Le signalement commence au préavis (orange) et devient urgent (rouge) à l'approche de l'échéance."
        />
        <div className="divide-y divide-border">
          {((docTypes ?? []) as DocumentTypeRow[]).map((t) => (
            <DocumentTypeForm key={t.id} t={t} />
          ))}
          <div className="bg-surface-muted/40">
            <DocumentTypeForm />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Entretien périodique"
          description="Intervalle en jours et/ou en kilomètres : l'entretien est dû au premier des deux atteint. Sans intervalle, l'intervention est ponctuelle (réparation)."
        />
        <div className="divide-y divide-border">
          {((serviceTypes ?? []) as ServiceTypeRow[]).map((t) => (
            <ServiceTypeForm key={t.id} t={t} />
          ))}
          <div className="bg-surface-muted/40">
            <ServiceTypeForm />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Bons de carburant"
          description="Plafond d'un bon (au-delà, la validation est refusée) et seuils à partir desquels un plein est signalé : consommation éloignée de l'habitude du véhicule, prix au litre éloigné du prix officiel, km au compteur éloignés des km GPS, véhicule loin de la station à l'heure du ticket."
        />
        <FuelSettingsForm
          plafond={reglages?.plafond_bon ? Number(reglages.plafond_bon) : null}
          conso={reglages?.ecart_consommation_pct ?? 25}
          prix={reglages?.ecart_prix_pct ?? 10}
          ecartKm={reglages?.ecart_km_gps_pct ?? 15}
          distance={reglages?.distance_station_max_m ?? 500}
        />
      </Card>

      <Card>
        <CardHeader title="Prix du litre à la pompe" description="Le prix en vigueur à la date d'un plein sert à contrôler le ticket." />
        <ul className="divide-y divide-border text-sm">
          {((prices ?? []) as { id: string; energie: string; prix_litre: number; depuis: string }[]).map((p) => (
            <li key={p.id} className="flex gap-6 px-5 py-2">
              <span className="w-20 capitalize">{p.energie}</span>
              <span className="w-28 tabular-nums">{formatAmount(Number(p.prix_litre))}</span>
              <span className="text-foreground-muted">depuis le {formatDate(p.depuis)}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-border bg-surface-muted/40">
          <FuelPriceForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Stations partenaires" description="La position GPS servira à vérifier, avec FreeTrack, que le véhicule était bien à la station à l'heure du ticket." />
        <div className="divide-y divide-border">
          {((stations ?? []) as StationRow[]).map((s) => (
            <StationForm key={s.id} s={s} />
          ))}
          <div className="bg-surface-muted/40">
            <StationForm />
          </div>
        </div>
      </Card>
    </div>
  );
}
