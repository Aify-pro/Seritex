"use client";

import { useEffect, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import { suggestQuoteLinePrices } from "../../actions";
import type { SizeOption } from "@/components/quotes/dispatch-editor";

export type PriceSource = "client" | "grille" | "saisie";

const SOURCE_LABEL: Record<PriceSource, string> = {
  client: "prix client",
  grille: "grille",
  saisie: "saisi",
};

/**
 * Prix par taille d'un article de devis (migration 0068). Proposés côté
 * serveur — dernier prix accordé à ce client pour ce modèle et ces
 * impressions, sinon grille tarifaire du modèle — et repris automatiquement
 * quand le modèle, la quantité, les impressions ou la devise changent, tant que
 * le commercial ne les a pas retouchés. Toutes les tailles du modèle sont
 * chiffrées : le client pourra redistribuer ses quantités à l'acceptation.
 */
export function LinePricesEditor({
  companyId,
  productModelId,
  textileId,
  quantity,
  printZones,
  devise,
  tauxChange,
  sizes,
  dispatch,
  prices,
  sources,
  auto,
  disabled,
  onChange,
}: {
  companyId: string;
  productModelId: string;
  /** Grammage choisi (ART-D) : le coût tissu, donc le prix, en dépend. */
  textileId: string | null;
  quantity: number;
  printZones: Record<string, number>;
  devise: string;
  tauxChange: number;
  sizes: SizeOption[];
  dispatch: Record<string, number>;
  prices: Record<string, string>;
  sources: Record<string, PriceSource>;
  /** Vrai : les prix suivent la proposition ; faux : retouchés à la main. */
  auto: boolean;
  disabled: boolean;
  onChange: (next: { prices: Record<string, string>; sources: Record<string, PriceSource>; auto: boolean }) => void;
}) {
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const printKey = JSON.stringify(Object.entries(printZones).sort());

  useEffect(() => {
    if (!auto || !productModelId || !(quantity > 0)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await suggestQuoteLinePrices({
        companyId,
        productModelId,
        textileId,
        quantity,
        printZones: (JSON.parse(printKey) as [string, number][]).map(([printable_zone_id, nb_couleurs]) => ({ printable_zone_id, nb_couleurs })),
        devise,
        tauxChange: tauxChange > 0 ? tauxChange : 1,
      });
      if (cancelled) return;
      setLoading(false);
      if ("error" in res && res.error) {
        setNotes([res.error]);
        return;
      }
      if ("suggestion" in res && res.suggestion) {
        setNotes(res.suggestion.notes);
        onChangeRef.current({
          prices: Object.fromEntries(Object.entries(res.suggestion.prices).map(([cle, v]) => [cle, String(v)])),
          sources: res.suggestion.sources,
          auto: true,
        });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auto, companyId, productModelId, textileId, quantity, printKey, devise, tauxChange]);

  // Groupe affiché : celui de la répartition, à défaut le premier du modèle.
  const groupe = sizes.find((s) => (dispatch[s.cle] ?? 0) > 0)?.groupe ?? sizes[0]?.groupe;
  const visibles = sizes.filter((s) => s.groupe === groupe);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Prix unitaire HT par taille ({devise === "XOF" ? "F CFA" : devise})</p>
        {!auto && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ prices, sources, auto: true })}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground hover:bg-surface-muted disabled:opacity-60"
          >
            <Wand2 className="h-3.5 w-3.5" /> Reprendre les prix proposés
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {visibles.map((s) => {
          const q = dispatch[s.cle] ?? 0;
          const src = sources[s.cle];
          return (
            <label key={s.cle} className="block">
              <span className="mb-0.5 block text-center text-[11px] text-foreground-muted">
                {s.libelle}
                {q > 0 ? ` · ${q} pc` : ""}
              </span>
              <input
                inputMode="decimal"
                value={prices[s.cle] ?? ""}
                disabled={disabled}
                placeholder="—"
                onChange={(e) =>
                  onChange({ prices: { ...prices, [s.cle]: e.target.value }, sources: { ...sources, [s.cle]: "saisie" }, auto: false })
                }
                className={`h-8 w-full rounded-md border bg-surface px-1 text-center text-sm ${q > 0 && !(Number(prices[s.cle]) > 0) ? "border-danger" : "border-border"}`}
              />
              {src && <span className="block text-center text-[10px] text-foreground-muted">{SOURCE_LABEL[src]}</span>}
            </label>
          );
        })}
      </div>
      {loading && <p className="text-xs text-foreground-muted">Recherche des prix…</p>}
      {notes.map((n) => (
        <p key={n} className="text-xs text-foreground-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
