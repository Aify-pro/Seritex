"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setStockMovementDepot } from "./actions";

/**
 * Dépôt Sage d'un mouvement (LIV-3, D5) : pré-rempli selon la nature,
 * modifiable tant que le mouvement n'est pas exporté. Lecture seule sinon.
 */
export function DepotEditor({ movementId, depot, editable }: { movementId: string; depot: string | null; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(depot ?? "");
  if (!editable) return <span className="font-mono text-xs">{depot ?? "—"}</span>;
  const save = () => {
    if (value.trim() === (depot ?? "")) return;
    startTransition(async () => {
      const res = await setStockMovementDepot(movementId, value);
      if (res.error) toast.error("Dépôt non enregistré", { description: res.error });
      else router.refresh();
    });
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && save()}
      disabled={pending}
      placeholder="Dépôt"
      aria-label="Dépôt Sage"
      className={`h-7 w-20 rounded-md border bg-surface px-1.5 font-mono text-xs ${value.trim() ? "border-border" : "border-warning"}`}
    />
  );
}
