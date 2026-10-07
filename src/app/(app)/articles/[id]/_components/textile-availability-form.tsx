"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveTextileAvailability } from "../stock/availability-actions";

export interface TextileAvailabilityColor {
  colorId: string;
  name: string;
  rouleaux: number;
  kg: number;
  statut: "disponible" | "indisponible" | "non_suivi";
}

const kgFmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Un grammage : interrupteur de suivi, seuil, et état de chaque couleur. */
export function TextileAvailabilityForm({
  modelId,
  textileId,
  grammage,
  suivi,
  seuilKg,
  colors,
  canModify,
}: {
  modelId: string;
  textileId: string;
  grammage: number | null;
  suivi: boolean;
  seuilKg: number;
  colors: TextileAvailabilityColor[];
  canModify: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState({ suivi, seuil: String(seuilKg) });
  const dirty = state.suivi !== suivi || Number(state.seuil) !== seuilKg;

  function save() {
    startTransition(async () => {
      const res = await saveTextileAvailability(modelId, textileId, { suivi: state.suivi, seuil_kg: Number(state.seuil) || 0 });
      if (res.error) toast.error(res.error);
      else toast.success("Suivi de disponibilité enregistré");
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{grammage != null ? `${grammage} g/m²` : "Tissu"}</span>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.suivi}
              disabled={!canModify || pending}
              onChange={(e) => setState({ ...state, suivi: e.target.checked })}
            />
            Suivre la disponibilité
          </label>
          <label className="flex items-center gap-2">
            Seuil
            <input
              type="number"
              min={0}
              step="0.5"
              value={state.seuil}
              disabled={!canModify || pending || !state.suivi}
              onChange={(e) => setState({ ...state, seuil: e.target.value })}
              className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-sm"
              aria-label="Seuil en kg"
            />
            kg
          </label>
          {canModify && (
            <Button size="sm" loading={pending} disabled={!dirty} onClick={save}>
              Enregistrer
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <span
            key={c.colorId}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              c.statut === "disponible"
                ? "border-success/30 bg-success-soft text-success"
                : c.statut === "indisponible"
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : "border-border bg-surface-muted text-foreground-muted"
            }`}
          >
            {c.name}
            <span className="font-normal opacity-80">{c.rouleaux > 0 ? `${c.rouleaux} rouleau(x) · ${kgFmt(c.kg)} kg` : "aucun rouleau"}</span>
          </span>
        ))}
        {colors.length === 0 && <span className="text-xs text-foreground-muted">Aucune couleur (ni déclinaison ni rouleau) sur ce grammage.</span>}
      </div>
      <p className="text-xs text-foreground-muted">
        Une couleur est disponible quand ses rouleaux en stock pèsent plus que le seuil (0 = au moins un rouleau non vide). Les rouleaux en coupe ou épuisés ne comptent pas.
        {!state.suivi && " Suivi désactivé : rien n'est signalé sur les articles qui utilisent ce grammage."}
      </p>
    </div>
  );
}
