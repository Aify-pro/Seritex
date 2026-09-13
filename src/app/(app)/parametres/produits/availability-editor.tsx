"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setProductModelSizes, setProductModelColors } from "../actions";

type Option = { id: string; label: string; groupe?: string };

/**
 * Disponibilité d'un modèle : dans quelles tailles et quelles couleurs il
 * existe. Le dispatching d'un ODF s'y limitera.
 *
 * Rien de coché = aucune restriction déclarée, donc tout le référentiel actif
 * reste proposable — et non « rien n'est disponible ». Sans cette convention,
 * la mise en service du référentiel rendrait d'un coup tous les modèles
 * existants incomplets, et bloquerait la saisie des ODF en cours.
 */
export function AvailabilityEditor({
  productModelId,
  sizes,
  colors,
  initialSizeIds,
  initialColorIds,
}: {
  productModelId: string;
  sizes: Option[];
  colors: Option[];
  initialSizeIds: string[];
  initialColorIds: string[];
}) {
  const [sizeIds, setSizeIds] = useState<string[]>(initialSizeIds);
  const [colorIds, setColorIds] = useState<string[]>(initialColorIds);
  const [pending, startTransition] = useTransition();

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function saveSizes(next: string[]) {
    setSizeIds(next);
    startTransition(async () => {
      const res = await setProductModelSizes(productModelId, next);
      if (res?.error) toast.error("Enregistrement refusé", { description: res.error });
    });
  }

  function saveColors(next: string[]) {
    setColorIds(next);
    startTransition(async () => {
      const res = await setProductModelColors(productModelId, next);
      if (res?.error) toast.error("Enregistrement refusé", { description: res.error });
    });
  }

  const groupes = [...new Set(sizes.map((s) => s.groupe ?? ""))];

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-xs font-medium text-foreground">Disponibilité</p>
        <p className="text-xs text-foreground-muted">
          Ce que ce modèle propose au dispatching. Rien de coché = tout le référentiel actif reste proposable.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-foreground-muted">
          Tailles {sizeIds.length > 0 && <span className="font-normal">({sizeIds.length} retenues)</span>}
        </p>
        {sizes.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            Référentiel de tailles vide — alimentez-le dans Couleurs et tailles.
          </p>
        ) : (
          <div className="space-y-2">
            {groupes.map((g) => (
              <div key={g}>
                {g && <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground-muted">{g}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {sizes
                    .filter((s) => (s.groupe ?? "") === g)
                    .map((s) => {
                      const on = sizeIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={pending}
                          onClick={() => saveSizes(toggle(sizeIds, s.id))}
                          className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                            on
                              ? "border-brand bg-brand-soft text-brand"
                              : "border-border text-foreground-muted hover:text-foreground"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-foreground-muted">
          Couleurs {colorIds.length > 0 && <span className="font-normal">({colorIds.length} retenues)</span>}
        </p>
        {colors.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            Aucune couleur active — alimentez la palette dans Couleurs et tailles.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => {
              const on = colorIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={pending}
                  onClick={() => saveColors(toggle(colorIds, c.id))}
                  className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                    on
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
