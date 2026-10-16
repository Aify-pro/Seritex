"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterField =
  | { kind: "select"; key: string; label: string; options: FilterOption[]; placeholder: string; primary?: boolean }
  /** Plusieurs valeurs possibles (ex. plusieurs statuts) : boutons à bascule, valeurs séparées par des virgules dans l'URL. */
  | { kind: "multi"; key: string; label: string; options: FilterOption[]; primary?: boolean }
  | { kind: "date"; key: string; label: string; primary?: boolean }
  | { kind: "number"; key: string; label: string; primary?: boolean };

const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30";

/**
 * Barre de recherche et de filtres générique des listes (demandes, devis,
 * visites…) : l'état complet vit dans l'URL — partageable, rechargeable, et
 * exactement ce qu'enregistre un préréglage. Les critères marqués `primary`
 * restent visibles (statuts pour traiter vite) ; les autres sont sous « Plus
 * de filtres ». Les champs inconnus de l'URL (tri, taille…) sont conservés.
 */
export function FilterBar({
  fields,
  sorts,
  defaultSort,
  placeholder,
  searchLabel,
  pageSizes,
}: {
  fields: FilterField[];
  sorts: FilterOption[];
  /** Tri et ordre appliqués quand l'URL n'en précise pas (non écrits dans l'URL). */
  defaultSort: { tri: string; ordre: "asc" | "desc" };
  placeholder: string;
  searchLabel: string;
  pageSizes: readonly number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const urlQ = searchParams.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const [sentQ, setSentQ] = useState(urlQ);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Resynchronise le champ quand l'URL change de l'extérieur (préréglage, Précédent), sans écraser une saisie en cours.
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    if (urlQ !== sentQ && urlQ !== text) setText(urlQ);
  }

  const secondary = fields.filter((f) => !f.primary);
  const primary = fields.filter((f) => f.primary);
  const filterKeys = fields.map((f) => f.key);
  const activeCount = [...filterKeys, "q"].filter((k) => (searchParams.get(k) ?? "") !== "").length;
  const secondaryActive = secondary.filter((f) => (searchParams.get(f.key) ?? "") !== "").length;
  const [advancedOpen, setAdvancedOpen] = useState(secondaryActive > 0);

  const tri = searchParams.get("tri") ?? defaultSort.tri;
  const ordre = searchParams.get("ordre") ?? defaultSort.ordre;
  const taille = searchParams.get("taille") ?? String(pageSizes[0]);

  function navigate(patch: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("page");
    for (const [k, v] of Object.entries(patch)) {
      if (v === "") sp.delete(k);
      else sp.set(k, v);
    }
    if (sp.get("tri") === defaultSort.tri && !sp.has("ordre")) sp.delete("tri");
    if (sp.get("tri") === defaultSort.tri && sp.get("ordre") === defaultSort.ordre) {
      sp.delete("tri");
      sp.delete("ordre");
    }
    if (sp.get("taille") === String(pageSizes[0])) sp.delete("taille");
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function onSearch(v: string) {
    setText(v);
    if (timer) clearTimeout(timer);
    setTimer(
      setTimeout(() => {
        const q = v.trim();
        setSentQ(q);
        navigate({ q });
      }, 350)
    );
  }

  function reset() {
    if (timer) clearTimeout(timer);
    setText("");
    setSentQ("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  function renderField(f: FilterField) {
    const value = searchParams.get(f.key) ?? "";
    if (f.kind === "multi") {
      const picked = value ? value.split(",") : [];
      return (
        <div key={f.key} className="flex flex-wrap items-center gap-1.5" role="group" aria-label={f.label}>
          <span className="mr-1 text-xs font-medium text-foreground-muted">{f.label}</span>
          {f.options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => navigate({ [f.key]: (on ? picked.filter((p) => p !== o.value) : [...picked, o.value]).join(",") })}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  on ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-foreground-muted hover:bg-surface-muted"
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <label key={f.key} className="block min-w-0">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">{f.label}</span>
        {f.kind === "select" ? (
          <select value={value} onChange={(e) => navigate({ [f.key]: e.target.value })} className={inputClass}>
            <option value="">{f.placeholder}</option>
            {value && !f.options.some((o) => o.value === value) && <option value={value}>{value}</option>}
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={f.kind === "date" ? "date" : "number"}
            min={f.kind === "number" ? 0 : undefined}
            value={value}
            onChange={(e) => navigate({ [f.key]: e.target.value })}
            className={inputClass}
          />
        )}
      </label>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="search"
            value={text}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={searchLabel}
            className={`${inputClass} pl-8`}
          />
        </div>
        <Button
          type="button"
          variant={advancedOpen ? "primary" : "secondary"}
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Plus de filtres
          {secondaryActive > 0 && <span className="rounded-full bg-brand-foreground/20 px-1.5 text-xs font-semibold">{secondaryActive}</span>}
          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </Button>
        {pending && <Loader2 className="mb-2 h-4 w-4 animate-spin text-foreground-muted" aria-label="Chargement" />}
        {activeCount > 0 && (
          <Button type="button" size="sm" variant="secondary" onClick={reset}>
            <X className="h-3.5 w-3.5" /> Réinitialiser ({activeCount})
          </Button>
        )}
      </div>

      {primary.length > 0 && <div className="space-y-2">{primary.map(renderField)}</div>}

      {advancedOpen && (
        <div className="space-y-3 border-t border-border pt-3">
          {secondary.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{secondary.map(renderField)}</div>
          )}
          <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground-muted">Trier par</span>
              <select value={tri} onChange={(e) => navigate({ tri: e.target.value })} className={inputClass}>
                {sorts.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground-muted">Ordre</span>
              <select value={ordre} onChange={(e) => navigate({ ordre: e.target.value })} className={inputClass}>
                <option value="asc">Croissant</option>
                <option value="desc">Décroissant</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground-muted">Par page</span>
              <select value={taille} onChange={(e) => navigate({ taille: e.target.value })} className={inputClass}>
                {pageSizes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
