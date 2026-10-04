"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addNomenclatureLine, linkNomenclatureLine, removeNomenclatureLine } from "../../actions";
import { Plus, Trash2 } from "lucide-react";

interface NomenclatureRow {
  id: string;
  designation: string;
  quantite_par_piece: number;
  unite: string;
  consumable_id?: string | null;
}

export interface ConsumableOption {
  id: string;
  code: string;
  designation: string;
  unite: string;
}

/**
 * Nomenclature d'un modèle de produit (lot 12) — composants constants hors
 * tissu (boutons, fil, étiquettes, emballage…) et leur quantité par pièce.
 * Depuis COM-G chaque ligne pointe vers un consommable du référentiel : c'est
 * ce qui permet la consommation théorique à la clôture des ODF.
 */
export function NomenclatureEditor({
  productModelId,
  lines,
  consumables,
}: {
  productModelId: string;
  lines: NomenclatureRow[];
  consumables: ConsumableOption[];
}) {
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
              <span className="text-foreground">
                {(() => {
                  const c = consumables.find((x) => x.id === l.consumable_id);
                  return c ? (
                    <>
                      <span className="mr-1.5 font-mono text-xs text-foreground-muted">{c.code}</span>
                      {c.designation}
                    </>
                  ) : (
                    <>
                      {l.designation}{" "}
                      <select
                        defaultValue=""
                        disabled={pending}
                        onChange={(e) =>
                          e.target.value &&
                          startTransition(async () => {
                            const res = await linkNomenclatureLine(l.id, e.target.value);
                            if (res?.error) toast.error(res.error);
                            else router.refresh();
                          })
                        }
                        className="ml-1 h-7 rounded-md border border-warning bg-surface px-1 text-xs"
                        aria-label="Relier à un consommable"
                      >
                        <option value="">Relier à un consommable…</option>
                        {consumables.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.code} · {o.designation}
                          </option>
                        ))}
                      </select>
                    </>
                  );
                })()}
              </span>
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
      {consumables.length === 0 && (
        <p className="text-xs text-warning">Aucun consommable au référentiel : créez-les d&apos;abord (Articles &gt; Consommables).</p>
      )}

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
            <label className="mb-1 block text-xs font-medium text-foreground">Consommable</label>
            <select name="consumable_id" required className="h-9 w-60 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">— Choisir —</option>
              {consumables.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.designation} ({c.unite})
                </option>
              ))}
            </select>
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
