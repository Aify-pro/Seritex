"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Link2, Unlink } from "lucide-react";
import { linkSampleToProductionOrderLine } from "@/lib/actions/samples";
import { PRODUCTION_ORDER_STATUS_LABELS, type ProductionOrderStatus } from "@/lib/types/domain";

export interface ProductionOrderLineOption {
  id: string;
  orderReference: string;
  description: string;
  status: ProductionOrderStatus;
}

/**
 * Lien libre échantillon ↔ article d'un ordre de fabrication (migration
 * 0044), modifiable à tout moment (section 3.6 de l'analyse) — pas une
 * transformation en OT, une simple référence journalisée. Par article
 * plutôt que par ODF entier : un ODF multi-articles peut avoir un
 * échantillon par article, jamais un lien ambigu "pour tout l'ODF".
 */
export function SampleProductionOrderLink({
  sampleId,
  currentProductionOrderLineId,
  companyProductionOrderLines,
}: {
  sampleId: string;
  currentProductionOrderLineId: string | null;
  companyProductionOrderLines: ProductionOrderLineOption[];
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const res = await linkSampleToProductionOrderLine(sampleId, value || null);
      if (res?.error) toast.error(res.error);
      else toast.success(value ? "Échantillon lié à l'article" : "Lien retiré");
    });
  }

  const current = companyProductionOrderLines.find((l) => l.id === currentProductionOrderLineId);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="flex items-center gap-1 font-medium text-foreground-muted">
        {currentProductionOrderLineId ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
        Article d&apos;ordre de fabrication :
      </span>
      <select
        disabled={pending}
        value={currentProductionOrderLineId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
      >
        <option value="">— Aucun lien —</option>
        {companyProductionOrderLines.map((l) => (
          <option key={l.id} value={l.id}>
            {l.orderReference} — {l.description} · {PRODUCTION_ORDER_STATUS_LABELS[l.status]}
          </option>
        ))}
      </select>
      {current && (
        <span className="text-foreground-muted">
          (actuellement {current.orderReference} — {current.description})
        </span>
      )}
    </div>
  );
}
