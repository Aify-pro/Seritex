"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateTauxCategorie } from "./actions";

export function CategoryRateForm({
  categorieId,
  taux,
  tauxDefaut,
}: {
  categorieId: string;
  taux: number | null;
  tauxDefaut: number;
}) {
  const [value, setValue] = useState(taux === null ? "" : String(taux));
  const [pending, startTransition] = useTransition();
  const initial = taux === null ? "" : String(taux);
  const dirty = value !== initial;

  function save() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("taux", value);
      const res = await updateTauxCategorie(categorieId, formData);
      if (res?.error) toast.error(res.error);
      else toast.success("Taux mis à jour");
    });
  }

  return (
    <div className="flex items-end gap-2">
      <div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            placeholder={`défaut (${tauxDefaut}%)`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-32 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          />
          <span className="text-xs text-foreground-muted">%</span>
        </div>
      </div>
      {dirty && (
        <Button size="sm" variant="secondary" onClick={save} loading={pending}>
          Enregistrer
        </Button>
      )}
    </div>
  );
}
