"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addNomenclatureLine, removeNomenclatureLine } from "../actions";
import { Plus, Trash2 } from "lucide-react";

interface NomenclatureRow {
  id: string;
  designation: string;
  quantite_par_piece: number;
  unite: string;
}

/** Nomenclature d'un modèle de produit (lot 12) — composants constants hors tissu (boutons, fil, colle, col...) et leur quantité par pièce. */
export function NomenclatureEditor({ productModelId, lines }: { productModelId: string; lines: NomenclatureRow[] }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function remove(lineId: string) {
    startTransition(async () => {
      const res = await removeNomenclatureLine(lineId);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-foreground-muted">Nomenclature</p>

      {lines.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-foreground">{l.designation}</span>
              <span className="flex items-center gap-2">
                <span className="text-foreground-muted">
                  {l.quantite_par_piece} {l.unite} / pièce
                </span>
                <button
                  disabled={pending}
                  onClick={() => remove(l.id)}
                  className="rounded-full p-0.5 opacity-60 hover:bg-danger-soft hover:text-danger hover:opacity-100 disabled:opacity-30"
                  aria-label={`Retirer ${l.designation}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 && <p className="text-xs text-foreground-muted">Aucune ligne de nomenclature.</p>}

      {!open ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
        </Button>
      ) : (
        <form
          ref={formRef}
          action={(formData) =>
            startTransition(async () => {
              const res = await addNomenclatureLine(formData);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Ligne ajoutée");
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
            <label className="mb-1 block text-xs font-medium text-foreground">Désignation</label>
            <input
              name="designation"
              required
              placeholder="Bouton"
              className="h-9 w-36 rounded-md border border-border bg-surface px-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Quantité / pièce</label>
            <input
              name="quantite_par_piece"
              type="number"
              step="0.001"
              min="0"
              required
              placeholder="4"
              className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Unité</label>
            <input
              name="unite"
              required
              placeholder="unité"
              className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
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
