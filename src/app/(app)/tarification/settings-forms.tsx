"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { coefficient } from "@/lib/pricing";
import { savePrintCosts, updatePricingSettings } from "./actions";

const num = (v: string) => Number(String(v).replace(",", "."));

/** Paramètres généraux : charges, marge, arrondi, frais d'écran (migration 0067). */
export function PricingSettingsForm({
  initial,
}: {
  initial: { chargesPct: number; margePct: number; arrondi: number; fraisEcranParCouleur: number; coefPrixVente?: number | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    charges: String(initial.chargesPct),
    marge: String(initial.margePct),
    arrondi: String(initial.arrondi),
    ecran: String(initial.fraisEcranParCouleur),
    coef: initial.coefPrixVente != null ? String(initial.coefPrixVente) : "",
  });
  const coefImpose = v.coef.trim() === "" ? null : num(v.coef);
  const coefCalcule = coefficient({ chargesPct: num(v.charges), margePct: num(v.marge) });
  const coef = coefficient({ chargesPct: num(v.charges), margePct: num(v.marge), coefPrixVente: coefImpose });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="Charges globales (%)" value={v.charges} onChange={(x) => setV({ ...v, charges: x })} disabled={pending} />
        <Field label="Marge cible (%)" value={v.marge} onChange={(x) => setV({ ...v, marge: x })} disabled={pending} />
        <Field label="Arrondi du prix (F CFA)" value={v.arrondi} onChange={(x) => setV({ ...v, arrondi: x })} disabled={pending} />
        <Field label="Frais d'écran par couleur (F CFA)" value={v.ecran} onChange={(x) => setV({ ...v, ecran: x })} disabled={pending} />
        <Field
          label="Coefficient de vente imposé"
          value={v.coef}
          onChange={(x) => setV({ ...v, coef: x })}
          disabled={pending}
          placeholder={coefCalcule ? coefCalcule.toFixed(3) : "—"}
        />
      </div>
      <p className="text-xs text-foreground-muted">
        Coefficient appliqué au prix de revient : <span className="font-medium text-foreground">{coef ? coef.toFixed(3) : "—"}</span> ({coefImpose !== null
          ? "imposé — les modèles qui ont leurs propres charges ou marge gardent la formule"
          : "PV = PR ÷ (1 − charges) ÷ (1 − marge), comme la grille Excel ; laissez le coefficient vide pour garder ce calcul"}
        ). Les frais d&apos;écran sont comptés une fois par couleur imprimée et par commande, puis répartis sur la quantité.
      </p>
      <Button
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await updatePricingSettings({
              charges_pct: num(v.charges),
              marge_pct: num(v.marge),
              arrondi: num(v.arrondi),
              frais_ecran_par_couleur: num(v.ecran),
              coef_prix_vente: coefImpose,
            });
            if (res.error) toast.error("Paramètres non enregistrés", { description: res.error });
            else {
              toast.success("Paramètres enregistrés");
              router.refresh();
            }
          })
        }
      >
        Enregistrer
      </Button>
    </div>
  );
}

const NB_MAX = 12;

/** Grille impression : coût par pièce selon le nombre de couleurs. */
export function PrintCostsForm({ initial }: { initial: Record<number, number> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<Record<number, string>>(
    Object.fromEntries(Array.from({ length: NB_MAX }, (_, i) => [i + 1, initial[i + 1] !== undefined ? String(initial[i + 1]) : ""]))
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Array.from({ length: NB_MAX }, (_, i) => i + 1).map((n) => (
          <Field key={n} label={`${n} couleur${n > 1 ? "s" : ""}`} value={v[n]} onChange={(x) => setV({ ...v, [n]: x })} disabled={pending} placeholder="—" />
        ))}
      </div>
      <p className="text-xs text-foreground-muted">
        Coût par pièce d&apos;une impression sur un emplacement. Une case vide retire ce nombre de couleurs de la grille : un devis qui l&apos;utilise sera signalé au
        chiffrage, jamais compté à 0.
      </p>
      <Button
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const payload = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() === "" ? null : num(x)]));
            const res = await savePrintCosts(payload);
            if (res.error) toast.error("Grille non enregistrée", { description: res.error });
            else {
              toast.success("Grille impression enregistrée");
              router.refresh();
            }
          })
        }
      >
        Enregistrer la grille
      </Button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
      />
    </label>
  );
}
