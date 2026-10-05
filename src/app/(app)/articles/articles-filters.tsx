"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ARTICLE_PAGE_SIZES,
  activeArticleFilterCount,
  articleFiltersToSearchParams,
  parseArticleFilters,
  type ArticleFilters,
  type ArticleSortKey,
} from "@/lib/articles/filters";
import type { FilterOption } from "@/lib/clients/filters";
import { NATURE_LABELS, TYPE_APPRO_LABELS, type ArticleNature, type TypeAppro } from "@/lib/articles/natures";

const SORT_LABELS: Record<ArticleSortKey, string> = {
  nom: "Nom",
  code: "Code",
  categorie: "Catégorie",
  declinaisons: "Nombre de déclinaisons",
  stock: "Stock disponible",
  prix: "Prix à partir de",
};

const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}

function OptionSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  placeholder: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {(o.label ?? o.value) + ` (${o.count})`}
        </option>
      ))}
    </select>
  );
}

/**
 * Recherche (sans accents) et « Recherche avancée » de la liste Articles —
 * même mécanique que la liste des clients : saisie locale immédiate, URL
 * mise à jour après un court délai, état complet dans l'URL.
 */
export function ArticlesFilters({
  values,
  options,
  showGrille,
}: {
  values: ArticleFilters;
  options: {
    familles: FilterOption[];
    sousFamilles: FilterOption[];
    categories: FilterOption[];
    matieres: FilterOption[];
    grammages: FilterOption[];
    couleurs: FilterOption[];
  };
  /** Filtre « grille de prix présente » : Direction et administrateur seulement (A2). */
  showGrille: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(values);
  const [prevValues, setPrevValues] = useState(values);
  const [sentQ, setSentQ] = useState(values.q);
  const activeCount = activeArticleFilterCount(values);
  const [advancedOpen, setAdvancedOpen] = useState(activeCount - (values.q ? 1 : 0) > 0);
  const localRef = useRef(local);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localRef.current = local;
  }, [local]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // Resynchronise depuis l'URL quand elle change de l'extérieur (Précédent,
  // lien partagé), sans écraser ce que l'utilisateur tape entre-temps.
  if (values !== prevValues) {
    setPrevValues(values);
    setLocal((l) => ({ ...values, q: values.q === sentQ || values.q === l.q ? l.q : values.q }));
  }

  function go(next: ArticleFilters) {
    const qs = articleFiltersToSearchParams({ ...next, page: 1 }).toString();
    setSentQ(next.q);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function navigate(patch: Partial<ArticleFilters>) {
    if (timer.current) clearTimeout(timer.current);
    const next = { ...localRef.current, ...patch, q: localRef.current.q.trim(), page: 1 };
    localRef.current = next;
    setLocal(next);
    go(next);
  }

  function onSearch(v: string) {
    localRef.current = { ...localRef.current, q: v };
    setLocal(localRef.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ ...localRef.current, q: localRef.current.q.trim() }), 350);
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    const defaults = parseArticleFilters({});
    localRef.current = defaults;
    setLocal(defaults);
    setSentQ("");
    const qs = articleFiltersToSearchParams(defaults).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const advancedActive = activeArticleFilterCount(local) - (local.q ? 1 : 0) - (local.nature ? 1 : 0);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="search"
            value={local.q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Rechercher : nom, code, famille, catégorie, matière, couleur, référence Sage…"
            aria-label="Rechercher un article"
            className={`${inputClass} pl-8`}
          />
        </div>
        <label className="w-48">
          <span className="sr-only">Nature</span>
          <select
            value={local.nature}
            onChange={(e) => navigate({ nature: e.target.value as "" | ArticleNature })}
            className={inputClass}
            aria-label="Nature"
          >
            <option value="">Toutes les natures</option>
            {(Object.keys(NATURE_LABELS) as ArticleNature[]).map((n) => (
              <option key={n} value={n}>
                {NATURE_LABELS[n]}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          size="md"
          variant={advancedOpen ? "primary" : "secondary"}
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Recherche avancée
          {advancedActive > 0 && (
            <span className="rounded-full bg-brand-foreground/20 px-1.5 text-xs font-semibold">{advancedActive}</span>
          )}
          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </Button>
        {pending && <Loader2 className="mb-2 h-4 w-4 animate-spin text-foreground-muted" aria-label="Chargement" />}
        {activeCount > 0 && (
          <Button type="button" size="sm" variant="secondary" onClick={reset}>
            <X className="h-3.5 w-3.5" /> Réinitialiser ({activeCount})
          </Button>
        )}
      </div>

      {advancedOpen && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Famille">
              <OptionSelect value={local.famille} onChange={(v) => navigate({ famille: v, sousFamille: "" })} options={options.familles} placeholder="Toutes" />
            </Field>
            <Field label="Sous-famille">
              <OptionSelect value={local.sousFamille} onChange={(v) => navigate({ sousFamille: v })} options={options.sousFamilles} placeholder="Toutes" />
            </Field>
            <Field label="Type">
              <select value={local.type} onChange={(e) => navigate({ type: e.target.value as "" | TypeAppro })} className={inputClass}>
                <option value="">Tous</option>
                {(Object.keys(TYPE_APPRO_LABELS) as TypeAppro[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_APPRO_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Catégorie">
              <OptionSelect value={local.categorie} onChange={(v) => navigate({ categorie: v })} options={options.categories} placeholder="Toutes" />
            </Field>
            <Field label="Actif">
              <select value={local.actif} onChange={(e) => navigate({ actif: e.target.value as ArticleFilters["actif"] })} className={inputClass}>
                <option value="oui">Actifs</option>
                <option value="non">Inactifs</option>
                <option value="tous">Tous</option>
              </select>
            </Field>
            <Field label="Matière">
              <OptionSelect value={local.matiere} onChange={(v) => navigate({ matiere: v })} options={options.matieres} placeholder="Toutes" />
            </Field>
            <Field label="Grammage">
              <OptionSelect value={local.grammage} onChange={(v) => navigate({ grammage: v })} options={options.grammages} placeholder="Tous" />
            </Field>
            <Field label="Couleur">
              <OptionSelect value={local.couleur} onChange={(v) => navigate({ couleur: v })} options={options.couleurs} placeholder="Toutes" />
            </Field>
            {showGrille && (
              <Field label="Grille de prix">
                <select value={local.grille} onChange={(e) => navigate({ grille: e.target.value as ArticleFilters["grille"] })} className={inputClass}>
                  <option value="">Peu importe</option>
                  <option value="avec">Avec grille</option>
                  <option value="sans">Sans grille</option>
                </select>
              </Field>
            )}
            <Field label="Référence Sage">
              <select value={local.sage} onChange={(e) => navigate({ sage: e.target.value as ArticleFilters["sage"] })} className={inputClass}>
                <option value="">Peu importe</option>
                <option value="avec">Renseignée</option>
                <option value="sans">Absente</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 sm:max-w-xl">
            <Field label="Trier par">
              <select value={local.tri} onChange={(e) => navigate({ tri: e.target.value as ArticleSortKey })} className={inputClass}>
                {(Object.keys(SORT_LABELS) as ArticleSortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ordre">
              <select value={local.ordre} onChange={(e) => navigate({ ordre: e.target.value as "asc" | "desc" })} className={inputClass}>
                <option value="asc">Croissant</option>
                <option value="desc">Décroissant</option>
              </select>
            </Field>
            <Field label="Par page">
              <select value={local.taille} onChange={(e) => navigate({ taille: Number(e.target.value) })} className={inputClass}>
                {ARTICLE_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
