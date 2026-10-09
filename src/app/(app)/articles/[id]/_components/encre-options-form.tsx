"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveArticleEncre } from "../../fiche-actions";

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70";

export type OptionsEncre = {
  hex: string;
  reference_couleur: string | null;
  gamme: string | null;
  sous_couche: boolean;
  depot_g_m2: number | null;
  separation: boolean;
};

/**
 * Options sérigraphie d'un article encre (sous-famille « Encres ») : ce que
 * l'outil « Séparation des couleurs » utilise pour proposer l'encre la plus
 * proche, la sous-couche et le prix de revient.
 */
export function EncreOptionsForm({
  productModelId,
  initial,
  depotDefaut,
  editable,
}: {
  productModelId: string;
  initial: OptionsEncre | null;
  depotDefaut: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    hex: initial?.hex ?? "",
    reference_couleur: initial?.reference_couleur ?? "",
    gamme: initial?.gamme ?? "",
    sous_couche: initial?.sous_couche ?? false,
    depot_g_m2: initial?.depot_g_m2 != null ? String(initial.depot_g_m2) : "",
    separation: initial?.separation ?? true,
  });
  const hexValide = /^#[0-9a-fA-F]{6}$/.test(v.hex);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Couleur</span>
          <span className="flex items-center gap-1.5">
            <input
              type="color"
              aria-label="Choisir la couleur de l'encre"
              value={hexValide ? v.hex : "#ffffff"}
              disabled={!editable}
              onChange={(e) => setV({ ...v, hex: e.target.value.toUpperCase() })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5"
            />
            <input value={v.hex} maxLength={7} placeholder="#D62828" disabled={!editable} onChange={(e) => setV({ ...v, hex: e.target.value })} className={`${input} font-mono`} />
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Référence de couleur</span>
          <input value={v.reference_couleur} maxLength={80} placeholder="PMS 485 C" disabled={!editable} onChange={(e) => setV({ ...v, reference_couleur: e.target.value })} className={`${input} font-mono`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Gamme</span>
          <input value={v.gamme} maxLength={60} placeholder="Plastisol" disabled={!editable} onChange={(e) => setV({ ...v, gamme: e.target.value })} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Dépôt (g/m²)</span>
          <input
            inputMode="decimal"
            value={v.depot_g_m2}
            placeholder={depotDefaut != null ? `${depotDefaut} (atelier)` : "paramètre de l'atelier"}
            disabled={!editable}
            onChange={(e) => setV({ ...v, depot_g_m2: e.target.value })}
            className={input}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.separation} disabled={!editable} onChange={(e) => setV({ ...v, separation: e.target.checked })} />
          Proposée par l&apos;outil de séparation des couleurs
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.sous_couche} disabled={!editable} onChange={(e) => setV({ ...v, sous_couche: e.target.checked })} />
          Encre de sous-couche (blanc couvrant pour textile foncé)
        </label>
      </div>
      {editable && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await saveArticleEncre(productModelId, v);
              if (res.error) toast.error("Options non enregistrées", { description: res.error });
              else {
                toast.success("Options sérigraphie enregistrées");
                router.refresh();
              }
            })
          }
        >
          Enregistrer
        </Button>
      )}
    </div>
  );
}
