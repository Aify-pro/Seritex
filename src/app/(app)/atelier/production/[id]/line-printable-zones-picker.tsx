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

/** Zone cochée et son nombre de couleurs — null pour une saisie antérieure à la migration 0065. */
export interface SelectedPrintableZone {
  id: string;
  nb_couleurs: number | null;
}

/** Même plafond que la contrainte de la migration 0065. */
const NB_COULEURS_MAX = 12;

/**
 * Zones imprimables cochées pour UN article de l'ODF (migration 0040),
 * parmi celles définies pour son modèle de produit (Paramètres > Produits >
 * Zone imprimable, migration 0039), avec le nombre de couleurs de chacune
 * (migration 0065 — hérité du devis, corrigeable ici). Simple sélection, pas
 * d'ordre à gérer — contrairement aux sections retenues (LineSectionsPicker),
 * qui pilotent un enchaînement de sous-ODF. Auto-enregistré à chaque
 * changement, même convention que LineSectionsPicker.
 */
export function LinePrintableZonesPicker({
  lineId,
  productionOrderId,
  zones,
  initialZones,
}: {
  lineId: string;
  productionOrderId: string;
  zones: PrintableZoneOption[];
  initialZones: SelectedPrintableZone[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<SelectedPrintableZone[]>(initialZones);

  function save(next: SelectedPrintableZone[]) {
    setSelected(next);
    startTransition(async () => {
      const res = await setProductionOrderLinePrintableZones(
        lineId,
        productionOrderId,
        next.map((z) => ({ printable_zone_id: z.id, nb_couleurs: z.nb_couleurs }))
      );
      if (res.error) {
        toast.error("Zones imprimables non enregistrées", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  function toggle(zoneId: string, checked: boolean) {
    save(checked ? [...selected, { id: zoneId, nb_couleurs: 1 }] : selected.filter((z) => z.id !== zoneId));
  }

  function setNbCouleurs(zoneId: string, nb: number | null) {
    save(selected.map((z) => (z.id === zoneId ? { ...z, nb_couleurs: nb } : z)));
  }

  const sortedZones = [...zones].sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Zones imprimables</p>
        <p className="text-[11px] text-foreground-muted">À sélectionner parmi les zones définies pour ce modèle, avec le nombre de couleurs imprimées.</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {sortedZones.map((zone) => {
          const chosen = selected.find((z) => z.id === zone.id);
          return (
            <div key={zone.id} className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={!!chosen}
                  disabled={pending}
                  onChange={(e) => toggle(zone.id, e.target.checked)}
                  className="h-4 w-4 rounded border-border text-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                />
                {zone.zone_label}
              </label>
              {chosen && (
                <select
                  value={chosen.nb_couleurs ?? ""}
                  disabled={pending}
                  onChange={(e) => setNbCouleurs(zone.id, e.target.value === "" ? null : Number(e.target.value))}
                  aria-label={`Nombre de couleurs — ${zone.zone_label}`}
                  className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs"
                >
                  {chosen.nb_couleurs === null && <option value="">Nb couleurs ?</option>}
                  {Array.from({ length: NB_COULEURS_MAX }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} coul.
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
