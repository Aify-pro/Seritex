"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { compactDispatch, dispatchGap, dispatchTotal, type Dispatch } from "@/lib/dispatching";

export type SizeOption = { id: string; groupe: string; libelle: string; cle: string };

/**
 * Saisie de la répartition par taille d'une ligne de devis (migration 0066).
 * Une ligne par taille du groupe choisi (Homme, Femme…), dans l'ordre métier ;
 * le total doit retomber sur la quantité de l'article, l'écart est affiché en
 * continu. Composant contrôlé, partagé entre le formulaire du commercial
 * (proposition automatique selon la règle) et l'écran client (ajustement à
 * l'acceptation, total fixe).
 */
export function DispatchEditor({
  sizes,
  value,
  onChange,
  quantity,
  disabled = false,
  onPropose,
  proposeLabel = "Proposer selon la règle",
}: {
  sizes: SizeOption[];
  value: Dispatch;
  onChange: (next: Dispatch) => void;
  quantity: number;
  disabled?: boolean;
  /** Présent : bouton de (re)proposition automatique — absent côté client. */
  onPropose?: (groupe: string) => void;
  proposeLabel?: string;
}) {
  const groupes = [...new Set(sizes.map((s) => s.groupe))];
  // Groupe affiché : celui de la répartition en cours, à défaut le premier.
  const groupeEnCours = sizes.find((s) => (value[s.cle] ?? 0) > 0)?.groupe;
  const [groupeChoisi, setGroupeChoisi] = useState<string | null>(null);
  const groupe = groupeChoisi ?? groupeEnCours ?? groupes[0] ?? "";
  const visibles = sizes.filter((s) => s.groupe === groupe);

  if (sizes.length === 0) {
    return <p className="text-xs text-foreground-muted">Aucune taille disponible pour ce modèle — fiche article, onglet Général.</p>;
  }

  const gap = dispatchGap(value, quantity);
  const total = dispatchTotal(value);

  function changeGroupe(next: string) {
    setGroupeChoisi(next);
    // Une répartition ne mélange pas deux groupes : changer de groupe repart de zéro.
    onChange({});
    onPropose?.(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Répartition par taille</p>
        <div className="flex items-center gap-2">
          {groupes.length > 1 && (
            <select
              value={groupe}
              disabled={disabled}
              onChange={(e) => changeGroupe(e.target.value)}
              aria-label="Groupe de tailles"
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
            >
              {groupes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          {onPropose && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPropose(groupe)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground hover:bg-surface-muted disabled:opacity-60"
            >
              <Wand2 className="h-3.5 w-3.5" /> {proposeLabel}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {visibles.map((s) => (
          <label key={s.cle} className="block">
            <span className="mb-0.5 block text-center text-[11px] text-foreground-muted">{s.libelle}</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              disabled={disabled}
              value={value[s.cle] ?? ""}
              onChange={(e) => {
                const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                onChange(compactDispatch({ ...value, [s.cle]: n }));
              }}
              className="h-8 w-full rounded-md border border-border bg-surface px-1 text-center text-sm"
            />
          </label>
        ))}
      </div>

      <p className={`text-xs ${gap === 0 ? "text-success" : "text-danger"}`}>
        {total} / {quantity} pièce{quantity > 1 ? "s" : ""} réparties
        {gap > 0 && ` — ${gap} de trop`}
        {gap < 0 && ` — il en manque ${-gap}`}
      </p>
    </div>
  );
}
