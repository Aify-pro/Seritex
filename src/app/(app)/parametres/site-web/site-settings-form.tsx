"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveSiteSettings } from "./actions";

interface Props {
  eshop: boolean;
  personnaliser: boolean;
  message: string | null;
  canModify: boolean;
}

function Interrupteur({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
      <div>
        <label htmlFor={id} className="font-medium text-foreground">
          {label}
        </label>
        <p className="mt-0.5 text-sm text-foreground-muted">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-success" : "bg-border"
        }`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
        <span className="sr-only">{checked ? "Activé" : "Désactivé"}</span>
      </button>
    </div>
  );
}

/** Paramètres > Site web : interrupteurs de l'e-shop et de l'outil « Personnaliser » (0110). */
export function SiteSettingsForm({ eshop, personnaliser, message, canModify }: Props) {
  const [v, setV] = useState({ eshop, personnaliser, message: message ?? "" });
  const [pending, startTransition] = useTransition();
  const modifie = v.eshop !== eshop || v.personnaliser !== personnaliser || v.message !== (message ?? "");

  return (
    <div className="space-y-4">
      <Interrupteur
        id="eshop"
        label="E-shop"
        description="Catalogue en ligne du site. Coupé : plus aucun article n'est affiché, et l'outil « Personnaliser » est coupé aussi."
        checked={v.eshop}
        disabled={!canModify || pending}
        onChange={(e) => setV({ ...v, eshop: e })}
      />
      <Interrupteur
        id="personnaliser"
        label="Outil « Personnaliser »"
        description={
          v.eshop
            ? "Le client compose sa maquette (article, logo, emplacement) et l'envoie : elle arrive dans Demandes."
            : "Activez d'abord l'e-shop : l'outil s'appuie sur son catalogue."
        }
        checked={v.eshop && v.personnaliser}
        disabled={!canModify || pending || !v.eshop}
        onChange={(p) => setV({ ...v, personnaliser: p })}
      />
      <div>
        <label htmlFor="message" className="text-sm font-medium text-foreground">
          Message affiché quand c&apos;est désactivé <span className="font-normal text-foreground-muted">(facultatif)</span>
        </label>
        <textarea
          id="message"
          rows={2}
          maxLength={400}
          disabled={!canModify || pending}
          value={v.message}
          onChange={(e) => setV({ ...v, message: e.target.value })}
          placeholder="Ex. : Boutique en ligne fermée pour inventaire jusqu'au 15 novembre. Nos conseillers restent joignables."
          className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-foreground-muted">Sans message : « La personnalisation en ligne est momentanément indisponible », avec un lien vers la demande de devis.</p>
      </div>
      {canModify ? (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            loading={pending}
            disabled={!modifie}
            onClick={() =>
              startTransition(async () => {
                const res = await saveSiteSettings({ eshop: v.eshop, personnaliser: v.eshop && v.personnaliser, message: v.message });
                if (res?.error) toast.error(res.error);
                else toast.success("Réglages du site enregistrés — appliqués sur le site sous une minute");
              })
            }
          >
            Enregistrer
          </Button>
          {modifie ? <span className="text-xs text-foreground-muted">Modifications non enregistrées</span> : null}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">Consultation seule : la modification est réservée aux rôles ayant le droit « Modifier » sur Site web.</p>
      )}
    </div>
  );
}
