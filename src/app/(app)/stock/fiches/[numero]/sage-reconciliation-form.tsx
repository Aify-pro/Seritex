"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recordSageReconciliation } from "@/app/(app)/atelier/stock/actions";

export function SageReconciliationForm({ ficheId }: { ficheId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sageNumero, setSageNumero] = useState("");

  function submit() {
    if (!sageNumero.trim()) {
      toast.error("Numéro de fiche Sage obligatoire");
      return;
    }
    startTransition(async () => {
      const res = await recordSageReconciliation(ficheId, sageNumero.trim());
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Fiche rapprochée");
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-foreground-muted">N° de fiche de mouvement Sage</label>
        <input
          value={sageNumero}
          onChange={(e) => setSageNumero(e.target.value)}
          placeholder="Ex : MVT-2026-000123"
          disabled={pending}
          className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        />
      </div>
      <Button size="sm" onClick={submit} loading={pending}>
        Valider
      </Button>
    </div>
  );
}
