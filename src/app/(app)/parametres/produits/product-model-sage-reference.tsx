"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setProductModelSageReference } from "../actions";

/**
 * Lot 10 : référence Sage d'un modèle de produit — colonne présente depuis
 * la migration 0005 mais jamais éditable depuis l'application jusqu'ici.
 * Nécessaire pour que les mouvements de stock entree_semi_fini/entree_fini
 * portent une référence exploitable par Sage (section 19).
 */
export function ProductModelSageReference({
  productModelId,
  sageReference,
}: {
  productModelId: string;
  sageReference: string | null;
}) {
  const [value, setValue] = useState(sageReference ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await setProductModelSageReference(productModelId, value);
      if (res?.error) toast.error(res.error);
      else toast.success("Référence Sage enregistrée");
    });
  }

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-[10px] text-foreground-muted">Référence Sage</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ex : TSH-BASIC-001"
          className="h-8 w-44 rounded-md border border-border bg-surface px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
      <Button size="sm" variant="secondary" onClick={save} loading={pending}>
        Enregistrer
      </Button>
    </div>
  );
}
