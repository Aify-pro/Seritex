"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { CompanySettings } from "@/lib/types/domain";
import { updateCompanySettings } from "./actions";

type TextKey = {
  [K in keyof CompanySettings]: CompanySettings[K] extends string | number | null ? K : never;
}[keyof CompanySettings];

type Field = {
  name: TextKey;
  label: string;
  hint?: string;
  type?: "text" | "email" | "number" | "textarea";
  wide?: boolean;
  required?: boolean;
  step?: string;
};

const SECTIONS: { title: string; description: string; fields: Field[] }[] = [
  {
    title: "Identité légale",
    description: "Mentions d'identification exigées sur les documents commerciaux (OHADA) et fiscaux (DGI).",
    fields: [
      { name: "raison_sociale", label: "Raison sociale", required: true },
      { name: "nom_commercial", label: "Nom commercial / enseigne" },
      { name: "forme_juridique", label: "Forme juridique", hint: "SARL, SA, SAS, entreprise individuelle…" },
      { name: "capital_social", label: "Capital social (F CFA)", type: "number", step: "1" },
      { name: "rccm", label: "N° RCCM", hint: "Registre du Commerce et du Crédit Mobilier" },
      { name: "ncc", label: "N° compte contribuable (NCC)", hint: "Identifiant fiscal DGI" },
      { name: "regime_imposition", label: "Régime d'imposition", hint: "Réel normal, réel simplifié…" },
      { name: "centre_impots", label: "Centre des impôts de rattachement" },
      { name: "numero_cnps", label: "N° employeur CNPS", hint: "Documents administratifs" },
    ],
  },
  {
    title: "Coordonnées",
    description: "Adresse du siège et moyens de contact imprimés en en-tête et pied de page.",
    fields: [
      { name: "adresse", label: "Adresse du siège", wide: true },
      { name: "boite_postale", label: "Boîte postale" },
      { name: "ville", label: "Ville" },
      { name: "pays", label: "Pays", required: true },
      { name: "telephone", label: "Téléphone" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "site_web", label: "Site web" },
    ],
  },
  {
    title: "Règlement",
    description: "Coordonnées de paiement indiquées au client sur la proforma.",
    fields: [
      { name: "banque_nom", label: "Banque" },
      { name: "banque_compte", label: "RIB / IBAN" },
      { name: "banque_swift", label: "Code SWIFT / BIC" },
      { name: "mobile_money", label: "Mobile money", hint: "ex. Orange Money 07 00 00 00 00" },
    ],
  },
  {
    title: "Signataire",
    description: "Personne qui signe les documents au nom de la société.",
    fields: [
      { name: "signataire_nom", label: "Nom du signataire" },
      { name: "signataire_fonction", label: "Fonction", hint: "ex. Directeur général" },
    ],
  },
  {
    title: "Valeurs par défaut des devis",
    description: "Pré-remplies à la création d'un devis, modifiables devis par devis.",
    fields: [
      { name: "tva_taux_defaut", label: "Taux de TVA par défaut (%)", type: "number", step: "0.01", hint: "Taux normal en Côte d'Ivoire : 18 %" },
      { name: "validite_devis_jours", label: "Validité du devis (jours)", type: "number", step: "1" },
      { name: "acompte_pct_defaut", label: "Acompte par défaut (%)", type: "number", step: "0.01" },
      { name: "conditions_paiement_defaut", label: "Conditions de paiement par défaut", type: "textarea", wide: true, hint: "ex. 50 % à la commande, solde à la livraison" },
      { name: "mentions_devis", label: "Mentions de pied de proforma", type: "textarea", wide: true, hint: "Pénalités de retard, réserve de propriété, juridiction compétente…" },
    ],
  },
];

const inputClass = "w-full rounded-md border border-border bg-surface px-2 text-sm";

export function CompanySettingsForm({ settings }: { settings: CompanySettings }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateCompanySettings(settings.id, formData);
          if (res?.error) toast.error(res.error);
          else toast.success("Informations société enregistrées");
        })
      }
      className="space-y-6"
    >
      {SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader title={section.title} description={section.description} />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.title === "Identité légale" && (
              <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
                <input type="checkbox" name="assujetti_tva" defaultChecked={settings.assujetti_tva} className="h-4 w-4" />
                Société assujettie à la TVA
              </label>
            )}
            {section.fields.map((f) => {
              const value = settings[f.name];
              return (
                <div key={f.name} className={f.wide ? "sm:col-span-2" : undefined}>
                  <label htmlFor={f.name} className="mb-1 block text-xs font-medium text-foreground">
                    {f.label}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea id={f.name} name={f.name} rows={3} defaultValue={value ?? ""} className={`${inputClass} py-1.5`} />
                  ) : (
                    <input
                      id={f.name}
                      name={f.name}
                      type={f.type ?? "text"}
                      step={f.step}
                      required={f.required}
                      defaultValue={value ?? ""}
                      className={`${inputClass} h-9`}
                    />
                  )}
                  {f.hint && <p className="mt-1 text-xs text-foreground-muted">{f.hint}</p>}
                </div>
              );
            })}
          </CardBody>
        </Card>
      ))}
      <Button type="submit" loading={pending}>
        Enregistrer
      </Button>
    </form>
  );
}
