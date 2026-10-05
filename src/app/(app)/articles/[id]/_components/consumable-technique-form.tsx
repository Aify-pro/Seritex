"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateConsumableTechnique } from "../../fiche-actions";

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70";

/** Consommable : code figé, étape où il est consommé, référence Sage. */
export function ConsumableTechniqueForm({
  consumable,
  editable,
}: {
  consumable: { id: string; code: string; famille: string | null; etape: "production" | "finition"; sage_reference: string | null };
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ etape: consumable.etape, sage_reference: consumable.sage_reference ?? "" });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Code</span>
          <p className="flex h-9 items-center font-mono text-sm">{consumable.code}</p>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Préfixe</span>
          <p className="flex h-9 items-center text-sm">{consumable.famille ?? "—"}</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Consommé en</span>
          <select value={v.etape} disabled={!editable} onChange={(e) => setV({ ...v, etape: e.target.value as "production" | "finition" })} className={input}>
            <option value="production">Production</option>
            <option value="finition">Finition</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Référence Sage</span>
          <input value={v.sage_reference} maxLength={18} disabled={!editable} onChange={(e) => setV({ ...v, sage_reference: e.target.value })} className={`${input} font-mono`} />
        </label>
      </div>
      {editable && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateConsumableTechnique(consumable.id, v);
              if (res.error) toast.error("Consommable non enregistré", { description: res.error });
              else {
                toast.success("Consommable enregistré");
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
