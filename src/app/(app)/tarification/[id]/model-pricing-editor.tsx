"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/currency";
import { priceGrid, type CostComponent } from "@/lib/pricing";
import { saveModelPricing } from "../actions";

type SizeOption = { cle: string; libelle: string; groupe: string };

type ComponentDraft = { key: string; libelle: string; base: string; supplements: Record<string, string>; estTissu: boolean };

const PRESETS = ["Tissu", "Col", "Confection", "Fournitures", "Charges fixes"];

const num = (v: string) => Number(String(v).replace(",", "."));
const isNum = (v: string) => v.trim() !== "" && Number.isFinite(num(v));

/**
 * Grille de prix d'un modèle (migration 0067) : composants en « base +
 * supplément par taille », calcul en direct du prix de revient, du prix de
 * vente arrondi et de la marge réelle, prix forcés taille par taille. Les
 * impressions ne figurent pas ici : elles dépendent de chaque devis.
 */
export function ModelPricingEditor({
  productModelId,
  sizes,
  defaults,
  initial,
}: {
  productModelId: string;
  sizes: SizeOption[];
  defaults: { chargesPct: number; margePct: number; arrondi: number };
  initial: { chargesPct: number | null; margePct: number | null; notes: string | null; components: CostComponent[]; forced: Record<string, number> };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const groupes = [...new Set(sizes.map((s) => s.groupe))];
  const [groupe, setGroupe] = useState(groupes[0] ?? "");
  const [charges, setCharges] = useState(initial.chargesPct === null ? "" : String(initial.chargesPct));
  const [marge, setMarge] = useState(initial.margePct === null ? "" : String(initial.margePct));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [components, setComponents] = useState<ComponentDraft[]>(
    initial.components.map((c) => ({
      key: c.id,
      libelle: c.libelle,
      base: String(c.base),
      supplements: Object.fromEntries(Object.entries(c.supplements).map(([k, v]) => [k, String(v)])),
      estTissu: !!c.estTissu,
    }))
  );
  const [forced, setForced] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial.forced).map(([k, v]) => [k, String(v)])));

  const visibles = sizes.filter((s) => s.groupe === groupe);
  const params = {
    chargesPct: isNum(charges) ? num(charges) : defaults.chargesPct,
    margePct: isNum(marge) ? num(marge) : defaults.margePct,
    arrondi: defaults.arrondi,
  };
  const parsedComponents: CostComponent[] = components.map((c) => ({
    id: c.key,
    libelle: c.libelle,
    base: isNum(c.base) ? num(c.base) : 0,
    supplements: Object.fromEntries(Object.entries(c.supplements).filter(([, v]) => isNum(v)).map(([k, v]) => [k, num(v)])),
    estTissu: c.estTissu,
  }));
  const parsedForced = Object.fromEntries(Object.entries(forced).filter(([, v]) => isNum(v) && num(v) > 0).map(([k, v]) => [k, num(v)]));
  const grid = priceGrid(parsedComponents, visibles.map((s) => s.cle), params, { forced: parsedForced });

  function updateComponent(key: string, patch: Partial<ComponentDraft>) {
    setComponents((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addComponent(libelle = "") {
    setComponents((prev) => [
      ...prev,
      { key: Math.random().toString(36).slice(2), libelle, base: "", supplements: {}, estTissu: libelle.toLowerCase().startsWith("tissu") },
    ]);
  }

  function save() {
    startTransition(async () => {
      const res = await saveModelPricing(productModelId, {
        charges_pct: isNum(charges) ? num(charges) : null,
        marge_pct: isNum(marge) ? num(marge) : null,
        notes,
        components: parsedComponents.map((c) => ({ libelle: c.libelle, base: c.base, supplements: c.supplements, est_tissu: !!c.estTissu })),
        forced: parsedForced,
      });
      if (res.error) toast.error("Grille non enregistrée", { description: res.error });
      else {
        toast.success("Grille enregistrée");
        router.refresh();
      }
    });
  }

  const missingPresets = PRESETS.filter((p) => !components.some((c) => c.libelle.trim().toLowerCase() === p.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Charges de ce modèle (%)</span>
          <input
            inputMode="decimal"
            value={charges}
            placeholder={`${defaults.chargesPct} (par défaut)`}
            disabled={pending}
            onChange={(e) => setCharges(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Marge cible de ce modèle (%)</span>
          <input
            inputMode="decimal"
            value={marge}
            placeholder={`${defaults.margePct} (par défaut)`}
            disabled={pending}
            onChange={(e) => setMarge(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </label>
        <p className="self-end pb-2 text-sm text-foreground-muted">
          Coefficient : <span className="font-medium text-foreground">{grid.coefficient ? grid.coefficient.toFixed(3) : "—"}</span> · arrondi à{" "}
          {formatMoney(defaults.arrondi)}
        </p>
      </div>

      {groupes.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium text-foreground">Groupe de tailles affiché</span>
          <select value={groupe} onChange={(e) => setGroupe(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
            {groupes.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <span className="text-xs text-foreground-muted">— ce modèle ne déclare pas ses tailles : toutes sont proposées (Paramètres &gt; Modèles de produits).</span>
        </label>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-foreground">Composants du prix de revient (F CFA par pièce)</p>
        <p className="mb-2 text-xs text-foreground-muted">
          « Base » s&apos;applique à toutes les tailles ; une case de taille ajoute un supplément (vide = 0, négatif possible). Cochez « Tissu » sur le composant
          tissu : c&apos;est la part que remplace le tissu pesé dans le prix de revient réel.
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-foreground-muted">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Composant</th>
                <th className="px-2 py-2 font-medium" title="Part remplacée par le tissu pesé dans le prix de revient réel">Tissu</th>
                <th className="px-2 py-2 font-medium">Base</th>
                {visibles.map((s) => (
                  <th key={s.cle} className="px-1 py-2 font-medium">
                    + {s.libelle}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {components.map((c) => (
                <tr key={c.key}>
                  <td className="px-2 py-1.5">
                    <input
                      value={c.libelle}
                      disabled={pending}
                      onChange={(e) => updateComponent(c.key, { libelle: e.target.value })}
                      className="h-8 w-36 rounded-md border border-border bg-surface px-2 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={c.estTissu}
                      disabled={pending}
                      onChange={(e) => updateComponent(c.key, { estTissu: e.target.checked })}
                      aria-label={`${c.libelle || "Composant"} : tissu`}
                      className="h-4 w-4 rounded border-border text-brand"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      inputMode="decimal"
                      value={c.base}
                      disabled={pending}
                      onChange={(e) => updateComponent(c.key, { base: e.target.value })}
                      className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm"
                    />
                  </td>
                  {visibles.map((s) => (
                    <td key={s.cle} className="px-1 py-1.5">
                      <input
                        inputMode="decimal"
                        value={c.supplements[s.cle] ?? ""}
                        placeholder="0"
                        disabled={pending}
                        onChange={(e) => updateComponent(c.key, { supplements: { ...c.supplements, [s.cle]: e.target.value } })}
                        className="h-8 w-16 rounded-md border border-border bg-surface px-1 text-right text-sm"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setComponents((prev) => prev.filter((x) => x.key !== c.key))}
                      title="Retirer ce composant"
                      className="text-foreground-muted hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => addComponent()}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un composant
          </Button>
          {missingPresets.map((p) => (
            <Button key={p} type="button" size="sm" variant="ghost" disabled={pending} onClick={() => addComponent(p)}>
              + {p}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-foreground">Prix par taille</p>
        {grid.warnings.length > 0 && (
          <ul className="mb-2 list-disc pl-5 text-xs text-danger">
            {grid.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-foreground-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Taille</th>
                <th className="px-3 py-2 text-right font-medium">Prix de revient</th>
                <th className="px-3 py-2 text-right font-medium">Prix calculé</th>
                <th className="px-3 py-2 text-right font-medium">Prix forcé</th>
                <th className="px-3 py-2 text-right font-medium">Marge réelle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grid.sizes.map((row) => {
                const s = visibles.find((x) => x.cle === row.cle)!;
                const sousCible = row.margeReellePct !== null && row.margeReellePct < params.margePct - 0.01;
                return (
                  <tr key={row.cle}>
                    <td className="px-3 py-1.5 font-medium text-foreground">{s.libelle}</td>
                    <td className="px-3 py-1.5 text-right">{formatMoney(Math.round(row.pr * 100) / 100)}</td>
                    <td className="px-3 py-1.5 text-right">{row.pvCalcule === null ? "—" : formatMoney(row.pvCalcule)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        inputMode="decimal"
                        value={forced[row.cle] ?? ""}
                        placeholder="—"
                        disabled={pending}
                        onChange={(e) => setForced({ ...forced, [row.cle]: e.target.value })}
                        className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm"
                      />
                    </td>
                    <td className={`px-3 py-1.5 text-right ${sousCible ? "font-medium text-danger" : "text-foreground"}`}>
                      {row.margeReellePct === null ? "—" : `${row.margeReellePct.toFixed(1)} %`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-foreground-muted">
          Un prix forcé remplace le prix calculé ; la marge réelle passe en rouge sous la marge cible. Le prix retenu par taille est le prix de vente par défaut
          de l&apos;article, hors impressions.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground">Notes internes (source des coûts, date des prix fournisseur…)</span>
        <textarea
          value={notes}
          disabled={pending}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </label>

      <Button loading={pending} onClick={save}>
        Enregistrer la grille
      </Button>
    </div>
  );
}
