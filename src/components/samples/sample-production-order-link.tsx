"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Link2, Unlink } from "lucide-react";
import { linkSampleToProductionOrder } from "@/lib/actions/samples";
import { PRODUCTION_ORDER_STATUS_LABELS, type ProductionOrderStatus } from "@/lib/types/domain";

/**
 * Lien libre échantillon ↔ ordre de fabrication, modifiable à tout moment
 * (section 3.6 de l'analyse) — pas une transformation en OT, une simple
 * référence journalisée.
 */
export function SampleProductionOrderLink({
  sampleId,
  currentProductionOrderId,
  companyProductionOrders,
}: {
  sampleId: string;
  currentProductionOrderId: string | null;
  companyProductionOrders: { id: string; reference: string; status: ProductionOrderStatus }[];
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const res = await linkSampleToProductionOrder(sampleId, value || null);
      if (res?.error) toast.error(res.error);
      else toast.success(value ? "Échantillon lié à l'ordre de fabrication" : "Lien retiré");
    });
  }

  const current = companyProductionOrders.find((po) => po.id === currentProductionOrderId);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="flex items-center gap-1 font-medium text-foreground-muted">
        {currentProductionOrderId ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
        Ordre de fabrication :
      </span>
      <select
        disabled={pending}
        value={currentProductionOrderId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
      >
        <option value="">— Aucun lien —</option>
        {companyProductionOrders.map((po) => (
          <option key={po.id} value={po.id}>
            {po.reference} · {PRODUCTION_ORDER_STATUS_LABELS[po.status]}
          </option>
        ))}
      </select>
      {current && <span className="text-foreground-muted">(actuellement {current.reference})</span>}
    </div>
  );
}
