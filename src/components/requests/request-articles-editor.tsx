"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ArticleLineDraft = {
  product_model_id: string;
  description: string;
  couleur_unique_id: string | null;
  tailles: Record<string, number>;
};

export interface ArticleModelOption {
  id: string;
  name: string;
  colors: { id: string; name: string }[];
  sizes: { cle: string; libelle: string }[];
}

const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

/**
 * Articles d'une demande : modèle, couleur et quantités par taille. Même
 * saisie pour une demande client et une demande pour le stock.
 */
export function RequestArticlesEditor({
  models,
  lines,
  onChange,
  disabled,
}: {
  models: ArticleModelOption[];
  lines: ArticleLineDraft[];
  onChange: (lines: ArticleLineDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<ArticleLineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const m = models.find((x) => x.id === l.product_model_id);
        const total = Object.values(l.tailles).reduce((s, q) => s + (q || 0), 0);
        return (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={l.product_model_id}
                disabled={disabled}
                onChange={(e) => {
                  const mm = models.find((x) => x.id === e.target.value);
                  update(i, { product_model_id: e.target.value, description: mm?.name ?? "", couleur_unique_id: null, tailles: {} });
                }}
                className={input}
                aria-label="Article"
              >
                <option value="">Article…</option>
                {models.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              {m && m.colors.length > 0 && (
                <select
                  value={l.couleur_unique_id ?? ""}
                  disabled={disabled}
                  onChange={(e) => update(i, { couleur_unique_id: e.target.value || null })}
                  className={input}
                  aria-label="Couleur"
                >
                  <option value="">Couleur…</option>
                  {m.colors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={l.description}
                disabled={disabled}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="Désignation"
                className={`${input} w-56`}
              />
              {total > 0 && <span className="text-xs tabular-nums text-foreground-muted">{total} pièce(s)</span>}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
                className="text-foreground-muted hover:text-danger"
                aria-label="Retirer l'article"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {m && (
              <div className="flex flex-wrap gap-2">
                {m.sizes.map((s) => (
                  <label key={s.cle} className="flex w-16 flex-col items-center gap-1 text-[11px] text-foreground-muted">
                    {s.libelle}
                    <input
                      type="number"
                      min={0}
                      disabled={disabled}
                      value={l.tailles[s.cle] || ""}
                      onChange={(e) => update(i, { tailles: { ...l.tailles, [s.cle]: Math.max(0, Math.floor(Number(e.target.value))) } })}
                      className="h-8 w-16 rounded-md border border-border bg-surface px-1 text-center text-sm text-foreground"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => onChange([...lines, { product_model_id: "", description: "", couleur_unique_id: null, tailles: {} }])}
      >
        <Plus className="h-3.5 w-3.5" /> Article
      </Button>
    </div>
  );
}
