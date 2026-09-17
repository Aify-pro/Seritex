"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateTauxAcceptationDefaut } from "./actions";

export function DefaultRateForm({ id, taux }: { id: string; taux: number }) {
  const [value, setValue] = useState(String(taux));
  const [pending, startTransition] = useTransition();
  const dirty = value !== String(taux);

  function save() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("taux", value);
      const res = await updateTauxAcceptationDefaut(id, formData);
      if (res?.error) toast.error(res.error);
      else toast.success("Taux par défaut mis à jour");
    });
  }

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Taux d&apos;acceptation par défaut</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
          />
          <span className="text-sm text-foreground-muted">%</span>
        </div>
      </div>
      {dirty && (
        <Button size="sm" onClick={save} loading={pending}>
          Enregistrer
        </Button>
      )}
    </div>
  );
}
