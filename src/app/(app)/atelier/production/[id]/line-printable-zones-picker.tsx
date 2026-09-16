"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProductionOrderLinePrintableZones } from "../actions";

export interface PrintableZoneOption {
  id: string;
  zone_key: string;
  zone_label: string;
  display_order: number;
}

/**
 * Zones imprimables cochées pour UN article de l'ODF (migration 0040),
 * parmi celles définies pour son modèle de produit (Paramètres > Produits >
 * Zone imprimable, migration 0039). Simple sélection, pas d'ordre à gérer —
 * contrairement aux sections retenues (LineSectionsPicker), qui pilotent un
 * enchaînement de sous-ODF. Auto-enregistré à chaque coche/décoche, même
 * convention que LineSectionsPicker.
 */
export function LinePrintableZonesPicker({
  lineId,
  productionOrderId,
  zones,
  initialZoneIds,
}: {
  lineId: string;
  productionOrderId: string;
  zones: PrintableZoneOption[];
  initialZoneIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [zoneIds, setZoneIds] = useState<string[]>(initialZoneIds);

  function toggle(zoneId: string, checked: boolean) {
    const next = checked ? [...zoneIds, zoneId] : zoneIds.filter((id) => id !== zoneId);
    setZoneIds(next);
    startTransition(async () => {
      const res = await setProductionOrderLinePrintableZones(lineId, productionOrderId, next);
      if (res.error) {
        toast.error("Zones imprimables non enregistrées", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  const sortedZones = [...zones].sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Zones imprimables</p>
        <p className="text-[11px] text-foreground-muted">À sélectionner parmi les zones définies pour ce modèle.</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {sortedZones.map((zone) => (
          <label key={zone.id} className="flex items-center gap-1.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={zoneIds.includes(zone.id)}
              disabled={pending}
              onChange={(e) => toggle(zone.id, e.target.checked)}
              className="h-4 w-4 rounded border-border text-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
            {zone.zone_label}
          </label>
        ))}
      </div>
    </div>
  );
}
