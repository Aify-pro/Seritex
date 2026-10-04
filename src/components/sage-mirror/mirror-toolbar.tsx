"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MirrorFilterDef {
  key: string;
  label: string;
  /** Première entrée = « tout » (valeur vide). */
  options: { value: string; label: string }[];
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30";

/**
 * Recherche + filtres d'une liste miroir Sage. L'état vit dans l'URL
 * (`?q=…&filtre=…`), la page serveur refait la requête : même principe que la
 * liste des clients. La saisie reste locale et fluide, l'URL suit après un
 * court délai.
 */
export function MirrorToolbar({
  q,
  filterValues,
  filters,
  placeholder,
  label,
}: {
  q: string;
  filterValues: Record<string, string>;
  filters: MirrorFilterDef[];
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const [sentQ, setSentQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // Resynchronisation depuis l'URL (bouton Précédent, lien partagé) sans
  // écraser ce que l'utilisateur a tapé depuis le dernier envoi.
  if (q !== prevQ) {
    setPrevQ(q);
    if (q !== sentQ && q !== local) setLocal(q);
  }

  function push(nextQ: string, nextFilters: Record<string, string>) {
    const sp = new URLSearchParams();
    if (nextQ) sp.set("q", nextQ);
    for (const [k, v] of Object.entries(nextFilters)) if (v) sp.set(k, v);
    const qs = sp.toString();
    setSentQ(nextQ);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function onSearch(value: string) {
    setLocal(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(value.trim(), filterValues), 350);
  }

  function onFilter(key: string, value: string) {
    if (timer.current) clearTimeout(timer.current);
    push(local.trim(), { ...filterValues, [key]: value });
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    setLocal("");
    setSentQ("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  const activeCount = (local.trim() ? 1 : 0) + Object.values(filterValues).filter(Boolean).length;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="search"
            value={local}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            className={`${inputClass} pl-8`}
          />
        </div>
        {filters.map((f) => (
          <label key={f.key} className="block w-44 min-w-0">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">{f.label}</span>
            <select value={filterValues[f.key] ?? ""} onChange={(e) => onFilter(f.key, e.target.value)} className={inputClass}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {pending && <Loader2 className="mb-2 h-4 w-4 animate-spin text-foreground-muted" aria-label="Chargement" />}
        {activeCount > 0 && (
          <Button type="button" size="sm" variant="secondary" onClick={reset}>
            <X className="h-3.5 w-3.5" /> Réinitialiser ({activeCount})
          </Button>
        )}
      </div>
    </div>
  );
}
