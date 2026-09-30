"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CLIENT_PAGE_SIZES,
  CLIENT_STATUTS,
  activeFilterCount,
  filtersToSearchParams,
  parseClientFilters,
  type ClientFilterOptions,
  type ClientFilters,
  type ClientSortKey,
  type FilterOption,
} from "@/lib/clients/filters";

const STATUT_LABELS: Record<(typeof CLIENT_STATUTS)[number], string> = {
  actif: "Actifs",
  sommeil: "En sommeil (Sage)",
  archive: "Disparus de Sage",
  tous: "Tous les statuts",
};

const SORT_LABELS: Record<ClientSortKey, string> = {
  nom: "Nom",
  code: "Code Sage",
  ville: "Ville",
  contacts: "Nombre de contacts",
  activite: "Dernière activité",
  creation: "Date de création Sage",
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
  // Une valeur d'URL absente de la liste (donnée modifiée depuis) reste visible
  // et désélectionnable plutôt que de fausser silencieusement le résultat.
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

function ToggleSelect<T extends string>({
  value,
  onChange,
  choices,
}: {
  value: T | "";
  onChange: (v: T | "") => void;
  choices: { value: T | ""; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T | "")} className={inputClass}>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function ClientsFilters({
  values,
  options,
  activeCount,
}: {
  values: ClientFilters;
  options: ClientFilterOptions;
  activeCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // État local = ce que l'utilisateur voit (saisie immédiate) ; l'URL suit après
  // un court délai pour la recherche, tout de suite pour les listes.
  const [local, setLocal] = useState(values);
  const [prevValues, setPrevValues] = useState(values);
  const [sentQ, setSentQ] = useState(values.q);
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

  // Resynchronise depuis l'URL quand elle change de l'extérieur (bouton Précédent,
  // lien partagé). La réponse à NOTRE propre navigation ne doit pas écraser ce
  // que l'utilisateur a tapé entre-temps : on garde alors la saisie locale.
  if (values !== prevValues) {
    setPrevValues(values);
    setLocal((l) => ({ ...values, q: values.q === sentQ || values.q === l.q ? l.q : values.q }));
  }

  function go(next: ClientFilters) {
    const qs = filtersToSearchParams({ ...next, page: 1 }).toString();
    setSentQ(next.q);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function navigate(patch: Partial<ClientFilters>) {
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
    const defaults = parseClientFilters({});
    localRef.current = defaults;
    setLocal(defaults);
    setSentQ("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  // Filtres avancés actifs (hors saisie de recherche) : affichés sur le bouton pour
  // qu'un filtre posé ne passe pas inaperçu quand le panneau est replié.
  const advancedActive = activeFilterCount(local) - (local.q ? 1 : 0);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="search"
            value={local.q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Rechercher : nom, code Sage, SIRET, ville, téléphone, contact…"
            aria-label="Rechercher un client"
            className={`${inputClass} pl-8`}
          />
        </div>
        <Button
          type="button"
          size="md"
          variant={advancedOpen ? "primary" : "secondary"}
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          aria-controls="clients-recherche-avancee"
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
        <div id="clients-recherche-avancee" className="space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Statut">
              <select
                value={local.statut}
                onChange={(e) => navigate({ statut: e.target.value as ClientFilters["statut"] })}
                className={inputClass}
              >
                {CLIENT_STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {STATUT_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Famille">
              <OptionSelect value={local.famille} onChange={(v) => navigate({ famille: v })} options={options.familles} placeholder="Toutes" />
            </Field>
            <Field label="Zone / commune">
              <OptionSelect value={local.zone} onChange={(v) => navigate({ zone: v })} options={options.zones} placeholder="Toutes" />
            </Field>
            <Field label="Typologie">
              <OptionSelect value={local.typologie} onChange={(v) => navigate({ typologie: v })} options={options.typologies} placeholder="Toutes" />
            </Field>
            <Field label="Ville">
              <OptionSelect value={local.ville} onChange={(v) => navigate({ ville: v })} options={options.villes} placeholder="Toutes" />
            </Field>
            <Field label="Pays">
              <OptionSelect value={local.pays} onChange={(v) => navigate({ pays: v })} options={options.pays} placeholder="Tous" />
            </Field>
            <Field label="Commercial (Sage)">
              <OptionSelect
                value={local.representant}
                onChange={(v) => navigate({ representant: v })}
                options={options.representants}
                placeholder="Tous"
              />
            </Field>
            <Field label="Type">
              <ToggleSelect
                value={local.type}
                onChange={(v) => navigate({ type: v })}
                choices={[
                  { value: "", label: "Clients et prospects" },
                  { value: "client", label: "Clients" },
                  { value: "prospect", label: "Prospects" },
                ]}
              />
            </Field>
            <Field label="Origine">
              <ToggleSelect
                value={local.origine}
                onChange={(v) => navigate({ origine: v })}
                choices={[
                  { value: "", label: "Toutes" },
                  { value: "sage", label: "Importés de Sage" },
                  { value: "manuel", label: "Créés dans Seritex" },
                ]}
              />
            </Field>
            <Field label="Contacts">
              <ToggleSelect
                value={local.contacts}
                onChange={(v) => navigate({ contacts: v })}
                choices={[
                  { value: "", label: "Peu importe" },
                  { value: "avec", label: "Avec au moins un contact" },
                  { value: "sans", label: "Sans contact" },
                ]}
              />
            </Field>
            <Field label="Compte portail">
              <ToggleSelect
                value={local.portail}
                onChange={(v) => navigate({ portail: v })}
                choices={[
                  { value: "", label: "Peu importe" },
                  { value: "avec", label: "Avec compte portail" },
                  { value: "sans", label: "Sans compte portail" },
                ]}
              />
            </Field>
            <Field label="Activité">
              <ToggleSelect
                value={local.activite}
                onChange={(v) => navigate({ activite: v })}
                choices={[
                  { value: "", label: "Peu importe" },
                  { value: "en_cours", label: "Demande ou ODF en cours" },
                  { value: "aucune", label: "Aucune activité en cours" },
                ]}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:max-w-md">
            <Field label="Trier par">
              <select
                value={local.tri}
                onChange={(e) => navigate({ tri: e.target.value as ClientSortKey, ordre: e.target.value === "activite" || e.target.value === "creation" ? "desc" : "asc" })}
                className={inputClass}
              >
                {(Object.keys(SORT_LABELS) as ClientSortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ordre">
                <select value={local.ordre} onChange={(e) => navigate({ ordre: e.target.value as "asc" | "desc" })} className={inputClass}>
                  <option value="asc">Croissant</option>
                  <option value="desc">Décroissant</option>
                </select>
              </Field>
              <Field label="Par page">
                <select value={local.taille} onChange={(e) => navigate({ taille: Number(e.target.value) })} className={inputClass}>
                  {CLIENT_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
