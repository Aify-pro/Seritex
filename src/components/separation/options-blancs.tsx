"use client";

import { modeSousCouche, type OptionsSousCouche } from "@/lib/separation/sous-couche";
import type { Rendu } from "@/lib/separation/trame";
import { cn } from "@/lib/utils";

const champ = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground";

function Nombre({
  label,
  valeur,
  onChange,
  min,
  max,
  pas = 1,
  aide,
}: {
  label: string;
  valeur: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  pas?: number;
  aide?: string;
}) {
  return (
    <label className="block text-xs text-foreground-muted">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={pas}
        value={valeur}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className={cn(champ, "mt-1")}
      />
      {aide && <span className="mt-0.5 block text-[11px]">{aide}</span>}
    </label>
  );
}

/**
 * Options des blancs des textiles foncés : sous-couche (aplat ou tramée,
 * source du ton, densité, pas de blanc sous les tons foncés, rentré, trame)
 * et blanc de rehaut des hautes lumières.
 */
export function OptionsBlancs({
  options,
  onChange,
  rentreMm,
  onRentre,
  rendu,
}: {
  options: OptionsSousCouche;
  onChange: (o: OptionsSousCouche) => void;
  rentreMm: number;
  onRentre: (v: number) => void;
  rendu: Rendu["type"];
}) {
  const maj = (v: Partial<OptionsSousCouche>) => onChange({ ...options, ...v });
  const majTrame = (v: Partial<OptionsSousCouche["trame"]>) => maj({ trame: { ...options.trame, ...v } });
  const majRehaut = (v: Partial<OptionsSousCouche["rehaut"]>) => maj({ rehaut: { ...options.rehaut, ...v } });
  const mode = modeSousCouche(options, rendu);

  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-xs">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-foreground-muted">
          Sous-couche
          <select value={options.mode} onChange={(e) => maj({ mode: e.target.value as OptionsSousCouche["mode"] })} className={cn(champ, "mt-1")}>
            <option value="auto">Automatique ({rendu === "am" || rendu === "cmjn" ? "tramée" : "aplat"}, selon la trame des couleurs)</option>
            <option value="aplat">Aplat plein</option>
            <option value="tramee">Tramée</option>
          </select>
        </label>
        <label className="block text-xs text-foreground-muted">
          Ton du blanc
          <select value={options.source} onChange={(e) => maj({ source: e.target.value as OptionsSousCouche["source"] })} className={cn(champ, "mt-1")}>
            <option value="encres">Selon les encres (sous chaque couleur)</option>
            <option value="luminosite">Selon la luminosité de l&apos;image (plus de blanc dans les clairs)</option>
          </select>
        </label>
        <Nombre label="Densité (%)" valeur={options.densitePct} min={0} max={100} onChange={(v) => maj({ densitePct: v })} aide="Allège la sous-couche (toucher plus souple)." />
        <Nombre label="Rentré sous les couleurs (mm)" valeur={rentreMm} min={0} max={2} pas={0.05} onChange={onRentre} aide="Le blanc ne déborde pas au calage." />
        <Nombre
          label="Pas de blanc sous les tons foncés (L*)"
          valeur={options.sansSousFoncesL}
          min={0}
          max={100}
          onChange={(v) => maj({ sansSousFoncesL: v })}
          aide="0 = désactivé ; ex. 25 : le textile sert de noir dans les ombres."
        />
      </div>

      {(mode === "tramee" || options.rehaut.actif) && (
        <div className="grid gap-3 sm:grid-cols-5">
          <p className="text-[11px] font-medium text-foreground sm:col-span-5">
            Trame des blancs{mode === "tramee" ? "" : " (rehaut seulement : la sous-couche reste en aplat)"}
          </p>
          <Nombre label="Linéature (lpi)" valeur={options.trame.lpi} min={10} max={150} onChange={(v) => majTrame({ lpi: v })} />
          <Nombre label="Angle (°)" valeur={options.trame.angle} min={-90} max={180} pas={0.5} onChange={(v) => majTrame({ angle: v })} />
          <label className="block text-xs text-foreground-muted">
            Forme du point
            <select value={options.trame.forme} onChange={(e) => majTrame({ forme: e.target.value as OptionsSousCouche["trame"]["forme"] })} className={cn(champ, "mt-1")}>
              <option value="rond">Rond</option>
              <option value="elliptique">Elliptique</option>
              <option value="ligne">Ligne</option>
            </select>
          </label>
          <Nombre label="Point minimum (%)" valeur={options.trame.pointMinPct} min={0} max={50} onChange={(v) => majTrame({ pointMinPct: v })} />
          <Nombre label="Point maximum (%)" valeur={options.trame.pointMaxPct} min={50} max={100} onChange={(v) => majTrame({ pointMaxPct: v })} aide="Au-delà : blanc plein." />
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={options.rehaut.actif} onChange={(e) => majRehaut({ actif: e.target.checked })} />
          <span className="font-medium">Blanc de rehaut</span>
          <span className="text-foreground-muted">— hautes lumières, imprimé en dernier par-dessus les couleurs (tramé, angle de la sous-couche + 30°)</span>
        </label>
        {options.rehaut.actif && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Nombre label="À partir de la luminosité (L*)" valeur={options.rehaut.seuilL} min={30} max={99} onChange={(v) => majRehaut({ seuilL: v })} aide="Seuls les tons plus clairs reçoivent le rehaut." />
            <Nombre label="Densité du rehaut (%)" valeur={options.rehaut.densitePct} min={0} max={100} onChange={(v) => majRehaut({ densitePct: v })} />
          </div>
        )}
      </div>
    </div>
  );
}
