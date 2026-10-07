"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateDispatch, pickRule, type DispatchRule } from "@/lib/dispatching";

export type ArticleLineDraft = {
  product_model_id: string;
  description: string;
  couleur_unique_id: string | null;
  tailles: Record<string, number>;
  /** Quantité totale saisie (écran seulement : le détail par taille est seul enregistré). */
  quantite?: number;
  /** Groupe de tailles de la répartition (écran seulement). */
  groupe?: string;
};

export interface ArticleModelOption {
  id: string;
  name: string;
  colors: { id: string; name: string }[];
  sizes: { cle: string; libelle: string; groupe: string }[];
}

const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

const sum = (t: Record<string, number>) => Object.values(t).reduce((s, q) => s + (q || 0), 0);

/**
 * Articles d'une demande : modèle, couleur, quantité et répartition par
 * taille. Même saisie pour une demande client et une demande pour le stock.
 *
 * La quantité totale génère automatiquement la répartition par taille selon
 * la règle de Paramètres > Dispatching (palier de quantité, par groupe de
 * tailles) ; chaque taille reste modifiable ensuite, et le total suit.
 */
export function RequestArticlesEditor({
  models,
  dispatchRules,
  lines,
  onChange,
  disabled,
}: {
  models: ArticleModelOption[];
  dispatchRules: DispatchRule[];
  lines: ArticleLineDraft[];
  onChange: (lines: ArticleLineDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<ArticleLineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const groupesOf = (m: ArticleModelOption) => [...new Set(m.sizes.map((s) => s.groupe))];
  const groupeOf = (l: ArticleLineDraft, m: ArticleModelOption) =>
    l.groupe && groupesOf(m).includes(l.groupe) ? l.groupe : (m.sizes.find((s) => (l.tailles[s.cle] ?? 0) > 0)?.groupe ?? groupesOf(m)[0]);

  /** Répartition proposée par la règle ; null si aucune règle ne couvre cette quantité. */
  function dispatchFor(m: ArticleModelOption, groupe: string, quantite: number): Record<string, number> | null {
    const rule = pickRule(dispatchRules, groupe, quantite);
    if (!rule) return null;
    return generateDispatch(quantite, rule, m.sizes.filter((s) => s.groupe === groupe).map((s) => s.cle));
  }

  function changeQuantity(i: number, m: ArticleModelOption, value: string) {
    const l = lines[i];
    const q = Math.max(0, Math.floor(Number(value)) || 0);
    const groupe = groupeOf(l, m);
    update(i, { quantite: q, groupe, tailles: q > 0 ? (dispatchFor(m, groupe, q) ?? l.tailles) : {} });
  }

  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const m = models.find((x) => x.id === l.product_model_id);
        const total = sum(l.tailles);
        const groupe = m ? groupeOf(l, m) : undefined;
        const groupes = m ? groupesOf(m) : [];
        const sizes = m ? m.sizes.filter((s) => s.groupe === groupe) : [];
        const ruleMissing = !!m && !!l.quantite && l.quantite > 0 && total !== l.quantite;
        return (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={l.product_model_id}
                disabled={disabled}
                onChange={(e) => {
                  const mm = models.find((x) => x.id === e.target.value);
                  update(i, { product_model_id: e.target.value, description: mm?.name ?? "", couleur_unique_id: null, tailles: {}, quantite: undefined, groupe: undefined });
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
              {m && (
                <input
                  type="number"
                  min={0}
                  disabled={disabled}
                  value={l.quantite ?? (total || "")}
                  onChange={(e) => changeQuantity(i, m, e.target.value)}
                  placeholder="Quantité"
                  className={`${input} w-24`}
                  aria-label="Quantité"
                />
              )}
              {m && groupes.length > 1 && (
                <select
                  value={groupe}
                  disabled={disabled}
                  onChange={(e) => {
                    const g = e.target.value;
                    const q = l.quantite ?? total;
                    update(i, { groupe: g, tailles: q > 0 ? (dispatchFor(m, g, q) ?? {}) : {} });
                  }}
                  className={input}
                  aria-label="Groupe de tailles"
                >
                  {groupes.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              )}
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
                {sizes.map((s) => (
                  <label key={s.cle} className="flex w-16 flex-col items-center gap-1 text-[11px] text-foreground-muted">
                    {s.libelle}
                    <input
                      type="number"
                      min={0}
                      disabled={disabled}
                      value={l.tailles[s.cle] || ""}
                      onChange={(e) => {
                        const tailles = { ...l.tailles, [s.cle]: Math.max(0, Math.floor(Number(e.target.value)) || 0) };
                        update(i, { tailles, quantite: sum(tailles), groupe });
                      }}
                      className="h-8 w-16 rounded-md border border-border bg-surface px-1 text-center text-sm text-foreground"
                    />
                  </label>
                ))}
              </div>
            )}
            {ruleMissing && (
              <p className="text-xs text-foreground-muted">
                Aucune règle de dispatching pour ce groupe et cette quantité (Paramètres &gt; Dispatching) — saisissez la répartition par taille.
              </p>
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
