"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setProductModelTextile } from "../textiles/actions";

/**
 * Tissu principal du modèle. C'est lui qui décidera dans quel ordre de tracé
 * tombe chaque ligne d'un ODF : une commande mêlant plusieurs textiles donne
 * un ordre de tracé par textile, jamais un seul mêlant des géométries
 * incompatibles.
 */
export function ProductModelTextile({
  productModelId,
  textileId,
  textiles,
}: {
  productModelId: string;
  textileId: string | null;
  textiles: { id: string; nom: string }[];
}) {
  const [value, setValue] = useState(textileId ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-medium text-foreground-muted">Tissu principal</label>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          startTransition(async () => {
            const res = await setProductModelTextile(productModelId, next || null);
            if (res?.error) {
              setValue(previous);
              toast.error("Enregistrement refusé", { description: res.error });
            } else {
              toast.success("Tissu enregistré");
            }
          });
        }}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-50"
      >
        <option value="">Non déclaré</option>
        {textiles.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nom}
          </option>
        ))}
      </select>
      {textiles.length === 0 && (
        <span className="text-xs text-foreground-muted">Aucun textile actif — créez-en dans Paramètres &gt; Textiles.</span>
      )}
    </div>
  );
}
