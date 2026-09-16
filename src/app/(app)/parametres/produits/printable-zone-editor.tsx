"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addProductPrintableZone, removeProductPrintableZone } from "../actions";
import { ArrowRight, Plus, Trash2 } from "lucide-react";

interface PrintableZoneRow {
  id: string;
  zone_key: string;
  zone_label: string;
  display_order: number;
}

/** Zones imprimables d'un modèle de produit — référentiel distinct du gabarit de zones couleur, pour les sections de catégorie Impression. */
export function PrintableZoneEditor({
  productModelId,
  zones,
}: {
  productModelId: string;
  zones: PrintableZoneRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function remove(zoneId: string) {
    startTransition(async () => {
      const res = await removeProductPrintableZone(zoneId);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Zone imprimable</p>
        <p className="text-[11px] text-foreground-muted">
          Surfaces du produit où une impression peut être réalisée (sections de catégorie Impression).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {zones.map((z, i) => (
          <span key={z.id} className="flex items-center gap-1.5">
            <span className="group flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand">
              {z.zone_label}
              <button
                disabled={pending}
                onClick={() => remove(z.id)}
                className="rounded-full p-0.5 opacity-60 hover:bg-danger-soft hover:text-danger hover:opacity-100 disabled:opacity-30"
                aria-label={`Retirer ${z.zone_label}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
            {i < zones.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-foreground-muted" />}
          </span>
        ))}
        {zones.length === 0 && <p className="text-xs text-foreground-muted">Aucune zone imprimable définie.</p>}
      </div>

      {!open ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une zone imprimable
        </Button>
      ) : (
        <form
          ref={formRef}
          action={(formData) =>
            startTransition(async () => {
              const res = await addProductPrintableZone(formData);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Zone imprimable ajoutée");
                formRef.current?.reset();
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="product_model_id" value={productModelId} />
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Clé (technique)</label>
            <input
              name="zone_key"
              required
              placeholder="poitrine"
              className="h-9 w-32 rounded-md border border-border bg-surface px-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Libellé affiché</label>
            <input
              name="zone_label"
              required
              placeholder="Poitrine"
              className="h-9 w-40 rounded-md border border-border bg-surface px-2 text-sm"
            />
          </div>
          <Button type="submit" size="sm" loading={pending}>
            Ajouter
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Annuler
          </Button>
        </form>
      )}
    </div>
  );
}
