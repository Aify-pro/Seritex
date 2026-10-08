"use client";

import { useState } from "react";

const inputClass = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

export type EncreRow = {
  id: string;
  nom: string;
  hex: string;
  reference: string | null;
  gamme: string | null;
  sous_couche: boolean;
  active: boolean;
};

/** Champs d'une encre, partagés par l'ajout et la modification. */
export function EncreFields({ defaults }: { defaults?: EncreRow }) {
  const [hex, setHex] = useState(defaults?.hex ?? "");
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex);

  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Nom</label>
        <input name="nom" required defaultValue={defaults?.nom} placeholder="Ex : Rouge vif" className={`${inputClass} w-44`} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Couleur</label>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label="Choisir la couleur de l'encre"
            value={valid ? hex : "#ffffff"}
            onChange={(e) => setHex(e.target.value.toUpperCase())}
            className="h-9 w-9 cursor-pointer rounded-md border border-border bg-surface p-0.5"
          />
          <input
            name="hex"
            required
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            placeholder="#D62828"
            maxLength={7}
            className={`${inputClass} w-24 font-mono`}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Référence</label>
        <input
          name="reference"
          defaultValue={defaults?.reference ?? ""}
          placeholder="PMS 485 C"
          className={`${inputClass} w-36 font-mono`}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Gamme</label>
        <input name="gamme" defaultValue={defaults?.gamme ?? ""} placeholder="Plastisol" className={`${inputClass} w-32`} />
      </div>
      <label className="flex h-9 items-center gap-2 text-xs text-foreground">
        <input type="checkbox" name="sous_couche" defaultChecked={defaults?.sous_couche} />
        Sous-couche
      </label>
    </>
  );
}
