"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Search, X } from "lucide-react";
import { searchCompanies, type CompanySearchResult } from "@/lib/actions/companies";

/**
 * Sélecteur d'entreprise avec recherche (remplace un menu déroulant qui ne tient
 * plus avec plusieurs milliers de clients). Écrit l'identifiant choisi dans un
 * champ caché `name` pour rester compatible avec les formulaires à FormData.
 */
export function CompanyPicker({
  name = "company_id",
  required,
  onChange,
}: {
  name?: string;
  required?: boolean;
  onChange?: (company: CompanySearchResult | null) => void;
}) {
  const listId = useId();
  const [selected, setSelected] = useState<CompanySearchResult | null>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (selected || term.trim().length < 2) return;
    const id = ++requestId.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const found = await searchCompanies(term);
      // Ignore une réponse arrivée après une saisie plus récente.
      if (id === requestId.current) {
        setResults(found);
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [term, selected]);

  function choose(c: CompanySearchResult | null) {
    setSelected(c);
    setTerm("");
    setResults([]);
    setOpen(false);
    onChange?.(c);
  }

  const showList = open && !selected && term.trim().length >= 2;

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} required={required} />
      {selected ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-foreground-muted" />
            <span className="truncate font-medium text-foreground">{selected.name}</span>
            {selected.sage_code && <span className="shrink-0 font-mono text-xs text-foreground-muted">{selected.sage_code}</span>}
          </span>
          <button
            type="button"
            onClick={() => choose(null)}
            aria-label="Changer d'entreprise"
            className="rounded p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input
              type="text"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Rechercher un client : nom, code Sage, ville…"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          {showList && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
            >
              {results.map((c) => (
                <li key={c.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  >
                    <span className="truncate text-foreground">{c.name}</span>
                    <span className="shrink-0 text-xs text-foreground-muted">
                      {[c.sage_code, c.city].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-2 text-sm text-foreground-muted">{searching ? "Recherche…" : "Aucun client trouvé."}</li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
