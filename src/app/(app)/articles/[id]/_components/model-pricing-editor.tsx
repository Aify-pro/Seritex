"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/currency";
import { priceGrid, resolveComponents, type CostComponent, type FabricContext } from "@/lib/pricing";
import { proposeFabricAreaFromPlacement, saveFabricAreas, saveModelPricing } from "../prix-de-revient/actions";

type SizeOption = { cle: string; libelle: string; groupe: string };

type ComponentDraft = {
  key: string;
  libelle: string;
  base: string;
  supplements: Record<string, string>;
  estTissu: boolean;
  mode: "saisi" | "tissu_calcule";
  perte: string;
};

/** Textile proposé pour l'aperçu : grammage et prix au kg (Tarification). */
export type FabricOption = { id: string; nom: string; grammage: number | null; prixKg: number | null };

const PRESETS = ["Tissu", "Col", "Confection", "Fournitures", "Charges fixes"];

const num = (v: string) => Number(String(v).replace(",", "."));
const isNum = (v: string) => v.trim() !== "" && Number.isFinite(num(v));

/**
 * Grille de prix d'un modèle (migration 0067) : composants en « base +
 * supplément par taille », calcul en direct du prix de revient, du prix de
 * vente arrondi et de la marge réelle, prix forcés taille par taille. Les
 * impressions ne figurent pas ici : elles dépendent de chaque devis.
 *
 * Tissu calculé (ART-C, A9) : un composant peut être calculé — surface de la
 * taille × (1 + chutes) × grammage × prix au kg du textile. L'aperçu se fait
 * pour le grammage choisi ; le coût suit le grammage sans grille à saisir.
 */
export function ModelPricingEditor({
  productModelId,
  sizes,
  defaults,
  initial,
  fabrics,
  initialSurfaces,
}: {
  productModelId: string;
  sizes: SizeOption[];
  defaults: { chargesPct: number; margePct: number; arrondi: number };
  initial: { chargesPct: number | null; margePct: number | null; notes: string | null; components: CostComponent[]; forced: Record<string, number> };
  /** Grammages (textiles) autorisés du modèle, avec leur prix au kg. */
  fabrics: FabricOption[];
  /** Surface de tissu par pièce et par taille (m²). */
  initialSurfaces: Record<string, number>;
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
      mode: c.mode ?? "saisi",
      perte: c.pertePct ? String(c.pertePct) : "",
    }))
  );
  const [fabricId, setFabricId] = useState(fabrics[0]?.id ?? "");
  const [surfaces, setSurfaces] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initialSurfaces).map(([k, v]) => [k, String(v)]))
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
    mode: c.mode,
    pertePct: isNum(c.perte) ? num(c.perte) : 0,
  }));
  const fabricOption = fabrics.find((f) => f.id === fabricId) ?? null;
  const fabric: FabricContext | null = fabricOption
    ? {
        textileNom: fabricOption.nom,
        grammage: fabricOption.grammage,
        prixKg: fabricOption.prixKg,
        surfaces: Object.fromEntries(Object.entries(surfaces).filter(([, v]) => isNum(v)).map(([k, v]) => [k, num(v)])),
      }
    : null;
  const resolved = resolveComponents(parsedComponents, visibles.map((s) => s.cle), fabric);
  const parsedForced = Object.fromEntries(Object.entries(forced).filter(([, v]) => isNum(v) && num(v) > 0).map(([k, v]) => [k, num(v)]));
  const grid = priceGrid(resolved.components, visibles.map((s) => s.cle), params, { forced: parsedForced });
  const hasCalcule = parsedComponents.some((c) => c.mode === "tissu_calcule");

  function updateComponent(key: string, patch: Partial<ComponentDraft>) {
    setComponents((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addComponent(libelle = "") {
    setComponents((prev) => [
      ...prev,
      {
        key: Math.random().toString(36).slice(2),
        libelle,
        base: "",
        supplements: {},
        estTissu: libelle.toLowerCase().startsWith("tissu"),
        mode: "saisi",
        perte: "",
      },
    ]);
  }

  function save() {
    startTransition(async () => {
      const res = await saveModelPricing(productModelId, {
        charges_pct: isNum(charges) ? num(charges) : null,
        marge_pct: isNum(marge) ? num(marge) : null,
        notes,
        components: parsedComponents.map((c) => ({
          libelle: c.libelle,
          base: c.base,
          supplements: c.supplements,
          est_tissu: !!c.estTissu,
          mode_calcul: c.mode ?? "saisi",
          perte_pct: c.pertePct ?? 0,
        })),
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
          <span className="text-xs text-foreground-muted">— ce modèle ne déclare pas ses tailles : toutes sont proposées (fiche article, onglet Déclinaisons).</span>
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
                <th className="px-2 py-2 font-medium" title="Saisi : base + suppléments. Calculé : surface × grammage × prix au kg">Calcul</th>
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
                    <select
                      value={c.mode}
                      disabled={pending}
                      onChange={(e) => updateComponent(c.key, { mode: e.target.value as ComponentDraft["mode"], estTissu: e.target.value === "tissu_calcule" || c.estTissu })}
                      className="h-8 rounded-md border border-border bg-surface px-1 text-xs"
                    >
                      <option value="saisi">Saisi</option>
                      <option value="tissu_calcule">Tissu calculé</option>
                    </select>
                    {c.mode === "tissu_calcule" && (
                      <input
                        inputMode="decimal"
                        value={c.perte}
                        placeholder="chutes %"
                        disabled={pending}
                        onChange={(e) => updateComponent(c.key, { perte: e.target.value })}
                        className="ml-1 h-8 w-16 rounded-md border border-border bg-surface px-1 text-right text-xs"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      inputMode="decimal"
                      value={c.mode === "tissu_calcule" ? "" : c.base}
                      placeholder={c.mode === "tissu_calcule" ? "calculé" : undefined}
                      disabled={pending || c.mode === "tissu_calcule"}
                      onChange={(e) => updateComponent(c.key, { base: e.target.value })}
                      className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm"
                    />
                  </td>
                  {visibles.map((s) => (
                    <td key={s.cle} className="px-1 py-1.5">
                      <input
                        inputMode="decimal"
                        value={c.mode === "tissu_calcule" ? "" : (c.supplements[s.cle] ?? "")}
                        placeholder={c.mode === "tissu_calcule" ? "—" : "0"}
                        disabled={pending || c.mode === "tissu_calcule"}
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

      {hasCalcule && (
        <FabricSection
          productModelId={productModelId}
          visibles={visibles}
          fabrics={fabrics}
          fabricId={fabricId}
          setFabricId={setFabricId}
          surfaces={surfaces}
          setSurfaces={setSurfaces}
        />
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-foreground">
          Prix par taille{hasCalcule && fabricOption ? ` — ${fabricOption.nom}` : ""}
        </p>
        {[...resolved.warnings, ...grid.warnings].length > 0 && (
          <ul className="mb-2 list-disc pl-5 text-xs text-danger">
            {[...resolved.warnings, ...grid.warnings].map((w) => (
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

/** Grammage de l'aperçu et surfaces de tissu par taille (tissu calculé). */
function FabricSection({
  productModelId,
  visibles,
  fabrics,
  fabricId,
  setFabricId,
  surfaces,
  setSurfaces,
}: {
  productModelId: string;
  visibles: SizeOption[];
  fabrics: FabricOption[];
  fabricId: string;
  setFabricId: (id: string) => void;
  surfaces: Record<string, string>;
  setSurfaces: (s: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(source: "placement" | "saisie", values: Record<string, string>) {
    startTransition(async () => {
      const res = await saveFabricAreas(
        productModelId,
        Object.fromEntries(Object.entries(values).map(([k, v]) => [k, isNum(v) ? num(v) : null])),
        source
      );
      if (res.error) toast.error("Surfaces non enregistrées", { description: res.error });
      else {
        toast.success("Surfaces enregistrées");
        router.refresh();
      }
    });
  }

  function propose() {
    startTransition(async () => {
      const res = await proposeFabricAreaFromPlacement(productModelId);
      if (res.error) toast.error("Proposition impossible", { description: res.error });
      else if (res.surface === null || res.surface === undefined) toast.info("Aucun tracé de placement mesuré pour ce modèle.");
      else {
        const next = { ...surfaces };
        for (const s of visibles) if (!isNum(next[s.cle] ?? "")) next[s.cle] = String(res.surface);
        setSurfaces(next);
        toast.success(`${res.surface} m² par pièce proposés depuis les tracés — à ajuster par taille, puis enregistrer`);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-foreground">Grammage de l&apos;aperçu</span>
        <select value={fabricId} onChange={(e) => setFabricId(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
          {fabrics.length === 0 && <option value="">Aucun grammage autorisé (onglet Déclinaisons)</option>}
          {fabrics.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
              {f.grammage ? ` · ${f.grammage} g/m²` : ""}
              {f.prixKg ? ` · ${formatMoney(f.prixKg)}/kg` : " · prix au kg à saisir (Tarification)"}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-foreground-muted">Surface de tissu par pièce (m²), chutes non comprises — issue de la fiche de placement ou du patronnage, modifiable.</p>
      <div className="flex flex-wrap gap-2">
        {visibles.map((s) => (
          <label key={s.cle} className="flex w-20 flex-col gap-1 text-center text-[11px] text-foreground-muted">
            {s.libelle}
            <input
              inputMode="decimal"
              value={surfaces[s.cle] ?? ""}
              placeholder="m²"
              disabled={pending}
              onChange={(e) => setSurfaces({ ...surfaces, [s.cle]: e.target.value })}
              className="h-8 rounded-md border border-border bg-surface px-1 text-right text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={pending} onClick={() => save("saisie", surfaces)}>
          Enregistrer les surfaces
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={propose}>
          Proposer depuis la fiche de placement
        </Button>
      </div>
    </div>
  );
}
