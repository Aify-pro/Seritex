import { redirect } from "next/navigation";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@/lib/types/domain";
import { ActiveSwitch, InlineCreateForm } from "./referential-forms";

const ZONE_TYPE_LABELS = { commune: "Commune", interieur: "Intérieur", international: "International" } as const;
const INTEGRATION_LABELS = { manuel: "Manuel", yango: "Yango (e-shop)", dhl: "DHL (e-shop)" } as const;

/**
 * Paramètres > Livraison (LIV-0) : zones de livraison, transporteurs et
 * véhicules. Les lieux de livraison, eux, se gèrent sur la fiche client.
 */
export default async function LivraisonSettingsPage() {
  await requireModule("parametres_livraison");
  if (!(await can("livraisons", "view"))) redirect("/dashboard?erreur=acces_refuse");
  const supabase = await createClient();
  const [{ data: zones }, { data: carriers }, { data: vehicles }] = await Promise.all([
    supabase.from("delivery_zones").select("*").order("ordre"),
    supabase.from("carriers").select("*").order("nom"),
    supabase.from("vehicles").select("*").order("libelle"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livraison"
        description="Zones de livraison, transporteurs et véhicules. Les lieux de livraison se gèrent sur la fiche de chaque client."
      />

      <Card>
        <CardHeader title="Zones" description="Communes du district d'Abidjan, intérieur du pays, international." />
        <CardBody className="space-y-3">
          <ul className="flex flex-wrap gap-2">
            {(zones ?? []).map((z) => (
              <li key={z.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm">
                {z.nom}
                <span className="text-[11px] text-foreground-muted">{ZONE_TYPE_LABELS[z.type as keyof typeof ZONE_TYPE_LABELS]}</span>
                <ActiveSwitch kind="zone" id={z.id} actif={z.actif} />
              </li>
            ))}
          </ul>
          <InlineCreateForm
            kind="zone"
            label="Zone"
            fields={[
              { name: "nom", label: "Nouvelle zone", kind: "text", required: true },
              {
                name: "type",
                label: "Type",
                kind: "select",
                options: Object.entries(ZONE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Transporteurs"
          description="Flotte interne ou prestataire. Seul le mode « manuel » est actif : Yango et DHL viendront avec l'e-shop."
        />
        <CardBody className="space-y-3">
          <ul className="divide-y divide-border rounded-md border border-border">
            {(carriers ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {c.nom}{" "}
                  <span className="text-xs text-foreground-muted">
                    {c.type === "interne" ? "interne" : "prestataire"} · {INTEGRATION_LABELS[c.integration as keyof typeof INTEGRATION_LABELS]}
                  </span>
                </span>
                <ActiveSwitch kind="carrier" id={c.id} actif={c.actif} />
              </li>
            ))}
          </ul>
          <InlineCreateForm
            kind="carrier"
            label="Transporteur"
            fields={[
              { name: "nom", label: "Nouveau transporteur", kind: "text", required: true },
              {
                name: "type",
                label: "Type",
                kind: "select",
                options: [
                  { value: "interne", label: "Interne" },
                  { value: "prestataire", label: "Prestataire" },
                ],
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Véhicules" />
        <CardBody className="space-y-3">
          {(vehicles ?? []).length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucun véhicule enregistré.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {(vehicles ?? []).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    {v.libelle}{" "}
                    <span className="text-xs text-foreground-muted">
                      {VEHICLE_TYPE_LABELS[v.type as VehicleType]}
                      {v.immatriculation ? ` · ${v.immatriculation}` : ""}
                      {v.capacite_note ? ` · ${v.capacite_note}` : ""}
                    </span>
                  </span>
                  <ActiveSwitch kind="vehicle" id={v.id} actif={v.actif} />
                </li>
              ))}
            </ul>
          )}
          <InlineCreateForm
            kind="vehicle"
            label="Véhicule"
            fields={[
              {
                name: "type",
                label: "Type",
                kind: "select",
                options: Object.entries(VEHICLE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
              },
              { name: "libelle", label: "Libellé", kind: "text", required: true, placeholder: "Camion 1" },
              { name: "immatriculation", label: "Immatriculation", kind: "text", width: "w-32" },
              { name: "capacite_note", label: "Capacité", kind: "text", placeholder: "ex. 40 cartons" },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
