"use client";

import { useState } from "react";

export const FAMILLE_LABELS = { blanc: "Blanc", clair: "Clair", moyen: "Moyen", fonce: "Foncé" } as const;

const inputClass = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

/**
 * Champs d'une couleur, partagés par l'ajout et la modification : nom, référence
 * Pantone TCX (`code`), aperçu HEX (pastilles) et famille du fournisseur.
 */
export function ColorFields({
  defaults,
}: {
  defaults?: { name: string; code: string; hex: string | null; famille: string | null };
}) {
  const [hex, setHex] = useState(defaults?.hex ?? "");
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex);

  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Nom</label>
        <input name="name" required defaultValue={defaults?.name} placeholder="Ex : Bleu marine" className={`${inputClass} w-44`} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Référence TCX</label>
        <input
          name="code"
          required
          defaultValue={defaults?.code}
          placeholder="19-3932 TCX"
          className={`${inputClass} w-36 font-mono`}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Aperçu (HEX)</label>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label="Choisir la couleur d'aperçu"
            value={valid ? hex : "#ffffff"}
            onChange={(e) => setHex(e.target.value.toUpperCase())}
            className="h-9 w-9 cursor-pointer rounded-md border border-border bg-surface p-0.5"
          />
          <input
            name="hex"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            placeholder="#22396A"
            maxLength={7}
            className={`${inputClass} w-24 font-mono`}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Famille</label>
        <select name="famille" defaultValue={defaults?.famille ?? ""} className={`${inputClass} w-32`}>
          <option value="">À confirmer</option>
          {Object.entries(FAMILLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
