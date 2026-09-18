"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Normalisation de recherche pour un atelier : minuscules, accents retirés,
 * puis espaces, tirets et points supprimés. C'est ce dernier point qui compte
 * — sans lui, « ODF-2026-0123 », « odf 2026 0123 » et « 20260123 » seraient
 * trois recherches différentes alors que l'opérateur tape ce qu'il lit sur le
 * bon, comme il le lit.
 */
export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s\-._/]/g, "");
}

export type Suggestion = {
  /** Sous-ODF à faire apparaître (et déplier) quand la suggestion est choisie. */
  workOrderId: string;
  /** Matelas à surligner, quand c'est lui qui correspond. */
  matelasId?: string;
  kind: "Sous-ODF" | "ODF" | "Client" | "Article" | "OT" | "Matelas";
  label: string;
  hint: string | null;
};

/**
 * Barre de recherche de la file de travail. Le filtrage est intégralement
 * client : la page serveur a déjà chargé toute la file de la section, une
 * requête par frappe n'apprendrait rien de plus et serait inutilisable sur le
 * réseau d'un atelier.
 */
export function QueueSearch({
  value,
  onChange,
  suggestions,
  onPick,
  resultCount,
  totalCount,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  onPick: (suggestion: Suggestion) => void;
  resultCount: number;
  totalCount: number;
}) {
  const [focused, setFocused] = useState(false);
  // La sélection clavier est mémorisée avec la recherche pour laquelle elle a
  // été faite : changer de recherche repart donc de la première suggestion
  // sans qu'un effet ait à remettre l'index à zéro après coup.
  const [selection, setSelection] = useState<{ query: string; index: number }>({ query: "", index: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => suggestions.slice(0, 8), [suggestions]);
  const listOpen = focused && value.trim() !== "" && visible.length > 0;
  const activeIndex = selection.query === value ? Math.min(selection.index, Math.max(visible.length - 1, 0)) : 0;
  const setActiveIndex = (next: number) => setSelection({ query: value, index: next });

  // Le clic sur une suggestion passe par onMouseDown (avant le blur), mais un
  // clic ailleurs dans la page doit refermer la liste sans attendre le blur
  // de l'input — sur mobile, le champ garde volontiers le focus.
  useEffect(() => {
    if (!listOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [listOpen]);

  function pick(suggestion: Suggestion) {
    onPick(suggestion);
    setFocused(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (value) onChange("");
      else inputRef.current?.blur();
      setFocused(false);
      return;
    }
    if (!listOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((activeIndex + 1) % visible.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((activeIndex - 1 + visible.length) % visible.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = visible[activeIndex];
      if (picked) pick(picked);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher un ODF, un client, un matelas…"
          aria-label="Rechercher dans la file de travail"
          // 16px minimum : en dessous, iOS zoome sur le champ au focus et
          // l'opérateur doit repincer l'écran pour revoir sa file.
          className="h-11 w-full rounded-md border border-border bg-surface pl-9 pr-10 text-base outline-none focus:ring-2 focus:ring-brand/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Effacer la recherche"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {value.trim() !== "" && (
        <p className="mt-1 text-xs text-foreground-muted">
          {resultCount} résultat{resultCount > 1 ? "s" : ""} sur {totalCount}
        </p>
      )}

      {listOpen && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-md border border-border bg-surface shadow-xl"
        >
          {visible.map((s, i) => (
            <li key={`${s.kind}-${s.workOrderId}-${s.matelasId ?? ""}-${s.label}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  i === activeIndex ? "bg-surface-muted" : "hover:bg-surface-muted"
                )}
              >
                <span className="shrink-0 rounded-sm bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
                  {s.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                {s.hint && <span className="shrink-0 truncate text-xs text-foreground-muted">{s.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
