"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addProductZoneTemplate, removeProductZoneTemplate } from "../actions";
import { ArrowRight, Plus, Trash2 } from "lucide-react";

interface ZoneRow {
  id: string;
  zone_key: string;
  zone_label: string;
  display_order: number;
}

/** Gabarit de zones d'un modèle de produit (section 8) — liste de zones nommées, pas de visuel cliquable (V1 actée). */
export function ZoneTemplateEditor({ productModelId, zones }: { productModelId: string; zones: ZoneRow[] }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function remove(zoneId: string) {
    startTransition(async () => {
      const res = await removeProductZoneTemplate(zoneId);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
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
        {zones.length === 0 && <p className="text-xs text-foreground-muted">Aucune zone définie.</p>}
      </div>

      {!open ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une zone
        </Button>
      ) : (
        <form
          ref={formRef}
          action={(formData) =>
            startTransition(async () => {
              const res = await addProductZoneTemplate(formData);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Zone ajoutée");
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
              placeholder="col"
              className="h-9 w-32 rounded-md border border-border bg-surface px-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Libellé affiché</label>
            <input
              name="zone_label"
              required
              placeholder="Col"
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
