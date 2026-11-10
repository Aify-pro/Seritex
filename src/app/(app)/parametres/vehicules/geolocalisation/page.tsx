import { requireModule, can } from "@/lib/auth/permissions";
import { isPlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { testFreetrackConnection } from "@/lib/vehicules/freetrack-sync";
import type { FreetrackDevice } from "@/lib/vehicules/freetrack-parse";
import { AutoLinkButton, ConnectionButtons, ConnectionForm, DeviceRow } from "./geoloc-forms";

/**
 * Paramètres > Logistique > Géolocalisation (VEH-5) : connexion à FreeTrack
 * (lecture seule) et liaison de chaque traceur à son véhicule.
 */
export default async function GeolocalisationPage() {
  await requireModule("parametres_vehicules");
  const [admin, canLink, canCreate] = await Promise.all([isPlatformAdmin(), can("vehicules", "modify"), can("vehicules", "create")]);
  const supabase = await createClient();
  const [{ data: s }, { data: vehicles }] = await Promise.all([
    supabase
      .from("freetrack_settings")
      .select("base_url,email,actif,frequence_minutes,password_set_at,derniere_synchro_at,derniere_synchro_ok,derniere_erreur,traceurs_trouves")
      .maybeSingle(),
    supabase.from("vehicles").select("id,libelle,immatriculation,freetrack_device_id").neq("statut", "vendu").order("libelle"),
  ]);
  const configured = !!(s?.email && s?.password_set_at);

  let devices: FreetrackDevice[] = [];
  let devicesError: string | null = null;
  if (configured) {
    try {
      devices = (await testFreetrackConnection()).devices;
    } catch (e) {
      devicesError = e instanceof Error ? e.message : "FreeTrack injoignable.";
    }
  }
  const vehicleOptions = ((vehicles ?? []) as { id: string; libelle: string; immatriculation: string | null; freetrack_device_id: number | null }[]).map((v) => ({
    id: v.id,
    label: [v.libelle, v.immatriculation].filter(Boolean).join(" · "),
    deviceId: v.freetrack_device_id,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Géolocalisation"
        description="FreeTrack (Dioxygene) fournit la position, les trajets et les arrêts des véhicules. Seritex les lit sans jamais rien modifier sur FreeTrack."
      />

      <Card>
        <CardHeader
          title="Connexion à FreeTrack"
          description={admin ? "Réservé à l'administrateur de la plateforme. Le mot de passe est chiffré et ne s'affiche plus jamais." : "Seul l'administrateur de la plateforme modifie la connexion."}
          action={
            <div className="flex items-center gap-2">
              {s?.derniere_synchro_at ? (
                <Badge tone={s.derniere_synchro_ok ? "success" : "danger"}>
                  {s.derniere_synchro_ok ? "Synchronisé" : "Échec"} le {formatDateTime(s.derniere_synchro_at)}
                </Badge>
              ) : (
                <Badge tone="neutral">Jamais synchronisé</Badge>
              )}
              {admin && <ConnectionButtons disabled={!configured} />}
            </div>
          }
        />
        {s?.derniere_erreur && <p className="border-b border-border bg-danger-soft px-5 py-2 text-xs text-danger">{s.derniere_erreur}</p>}
        {admin ? (
          <ConnectionForm
            baseUrl={s?.base_url ?? "https://freetrack.di-oxygene.com"}
            email={s?.email ?? null}
            actif={s?.actif ?? false}
            frequence={s?.frequence_minutes ?? 5}
            passwordSetAt={s?.password_set_at ?? null}
          />
        ) : (
          <CardBody className="text-sm">
            {s?.email ? `Compte ${s.email}, synchronisation ${s.actif ? `toutes les ${s.frequence_minutes} min` : "désactivée"}.` : "Connexion non configurée."}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Traceurs${devices.length ? ` (${devices.length})` : ""}`}
          description="Reliez chaque traceur à son véhicule. Un traceur sans véhicule peut créer sa fiche, à compléter ensuite."
          action={canLink && devices.length > 0 ? <AutoLinkButton devices={devices.map((d) => ({ deviceId: d.deviceId, nom: d.nom }))} /> : undefined}
        />
        {!configured ? (
          <CardBody className="text-sm text-foreground-muted">Renseignez la connexion pour voir les traceurs.</CardBody>
        ) : devicesError ? (
          <CardBody className="text-sm text-danger">{devicesError}</CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-foreground-muted">
                  <th className="px-4 py-2 font-medium">Traceur</th>
                  <th className="px-4 py-2 font-medium">Dernier signal</th>
                  <th className="px-4 py-2 font-medium">Véhicule Seritex</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <DeviceRow
                    key={d.deviceId}
                    device={{ deviceId: d.deviceId, nom: d.nom, etat: d.etat, signalLe: d.signalLe }}
                    vehicles={vehicleOptions}
                    linkedVehicleId={vehicleOptions.find((v) => v.deviceId === d.deviceId)?.id ?? null}
                    canCreate={canCreate && canLink}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
