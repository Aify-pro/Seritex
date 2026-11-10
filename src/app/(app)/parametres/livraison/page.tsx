import { redirect } from "next/navigation";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import Link from "next/link";
import { ActiveSwitch, InlineCreateForm } from "./referential-forms";

const ZONE_TYPE_LABELS = { commune: "Commune", interieur: "Intérieur", international: "International" } as const;
const INTEGRATION_LABELS = { manuel: "Manuel", yango: "Yango (e-shop)", dhl: "DHL (e-shop)" } as const;

/**
 * Paramètres > Logistique > Livraison (LIV-0) : zones de livraison et
 * transporteurs. Les lieux de livraison se gèrent sur la fiche client, les
 * véhicules dans Logistique > Véhicules (0168).
 */
export default async function LivraisonSettingsPage() {
  await requireModule("parametres_livraison");
  if (!(await can("livraisons", "view"))) redirect("/dashboard?erreur=acces_refuse");
  const supabase = await createClient();
  const [{ data: zones }, { data: carriers }] = await Promise.all([
    supabase.from("delivery_zones").select("*").order("ordre"),
    supabase.from("carriers").select("*").order("nom"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livraison"
        description="Zones de livraison et transporteurs. Les lieux de livraison se gèrent sur la fiche de chaque client."
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

      <p className="text-sm text-foreground-muted">
        Les véhicules (papiers, chauffeur, carburant, entretien) se gèrent dans{" "}
        <Link href="/vehicules" className="font-medium text-brand hover:underline">
          Logistique &gt; Véhicules
        </Link>
        .
      </p>
    </div>
  );
}
