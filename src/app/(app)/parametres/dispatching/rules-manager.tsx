"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateDispatch, rulePctTotal, type DispatchRule } from "@/lib/dispatching";
import { deleteDispatchRule, saveDispatchRule } from "./actions";

type SizeOption = { cle: string; libelle: string };

type Draft = {
  key: string;
  id: string | null;
  qtyMin: string;
  qtyMax: string;
  pcts: Record<string, string>;
};

function toDraft(r: DispatchRule): Draft {
  return {
    key: r.id,
    id: r.id,
    qtyMin: String(r.qtyMin),
    qtyMax: r.qtyMax === null ? "" : String(r.qtyMax),
    pcts: Object.fromEntries(Object.entries(r.pcts).map(([cle, pct]) => [cle, String(pct)])),
  };
}

/**
 * Paliers de la règle de dispatching d'un groupe de tailles (migration 0066).
 * Chaque palier couvre une plage de quantité et porte un pourcentage par
 * taille (total 100 %) ; un aperçu montre la répartition qu'il donnerait sur
 * une quantité exemple, pour juger l'arrondi d'un coup d'œil.
 */
export function DispatchRulesManager({ groupe, sizes, rules }: { groupe: string; sizes: SizeOption[]; rules: DispatchRule[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>(rules.map(toDraft));

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addPalier() {
    const last = drafts[drafts.length - 1];
    const nextMin = last ? (Number(last.qtyMax) || Number(last.qtyMin) || 0) + 1 : 1;
    setDrafts((prev) => [
      ...prev,
      { key: Math.random().toString(36).slice(2), id: null, qtyMin: String(nextMin), qtyMax: "", pcts: last ? { ...last.pcts } : {} },
    ]);
  }

  function save(d: Draft) {
    const pcts = Object.fromEntries(
      Object.entries(d.pcts)
        .map(([cle, v]) => [cle, Number(String(v).replace(",", "."))] as const)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
    );
    startTransition(async () => {
      const res = await saveDispatchRule({
        id: d.id,
        groupe,
        qty_min: Number(d.qtyMin),
        qty_max: d.qtyMax === "" ? null : Number(d.qtyMax),
        pcts,
      });
      if ("error" in res && res.error) {
        toast.error("Palier non enregistré", { description: res.error });
        return;
      }
      toast.success("Palier enregistré");
      if ("id" in res && res.id) update(d.key, { id: res.id });
      router.refresh();
    });
  }

  function remove(d: Draft) {
    if (!d.id) {
      setDrafts((prev) => prev.filter((x) => x.key !== d.key));
      return;
    }
    startTransition(async () => {
      const res = await deleteDispatchRule(d.id!);
      if (res.error) {
        toast.error("Palier non supprimé", { description: res.error });
        return;
      }
      setDrafts((prev) => prev.filter((x) => x.key !== d.key));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {drafts.length === 0 && <p className="text-sm text-foreground-muted">Aucun palier : les devis de ce groupe se répartissent à la main.</p>}

      {drafts.map((d) => {
        const nums = Object.fromEntries(Object.entries(d.pcts).map(([cle, v]) => [cle, Number(String(v).replace(",", ".")) || 0]));
        const total = rulePctTotal(nums);
        const exemple = Math.max(Number(d.qtyMin) || 1, 100);
        const apercu = generateDispatch(exemple, { id: d.key, groupe, qtyMin: 1, qtyMax: null, pcts: nums }, sizes.map((s) => s.cle));
        const ok = Math.abs(total - 100) < 0.01;
        return (
          <div key={d.key} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">De (pièces)</span>
                <input
                  type="number"
                  min={1}
                  value={d.qtyMin}
                  disabled={pending}
                  onChange={(e) => update(d.key, { qtyMin: e.target.value })}
                  className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">À (pièces, vide = sans limite)</span>
                <input
                  type="number"
                  min={1}
                  value={d.qtyMax}
                  disabled={pending}
                  onChange={(e) => update(d.key, { qtyMax: e.target.value })}
                  className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                />
              </label>
              <p className={`pb-2 text-sm font-medium ${ok ? "text-success" : "text-danger"}`}>Total : {total} %</p>
              <div className="ml-auto flex gap-2 pb-0.5">
                <Button size="sm" loading={pending} disabled={!ok} onClick={() => save(d)}>
                  Enregistrer
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(d)} title="Supprimer ce palier">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-11">
              {sizes.map((s) => (
                <label key={s.cle} className="block">
                  <span className="mb-0.5 block text-center text-[11px] text-foreground-muted">{s.libelle}</span>
                  <input
                    inputMode="decimal"
                    value={d.pcts[s.cle] ?? ""}
                    disabled={pending}
                    placeholder="0"
                    onChange={(e) => update(d.key, { pcts: { ...d.pcts, [s.cle]: e.target.value } })}
                    className="h-8 w-full rounded-md border border-border bg-surface px-1 text-center text-sm"
                  />
                </label>
              ))}
            </div>

            {ok && (
              <p className="text-xs text-foreground-muted">
                Aperçu sur {exemple} pièces :{" "}
                {sizes
                  .filter((s) => apercu[s.cle])
                  .map((s) => `${s.libelle} ${apercu[s.cle]}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        );
      })}

      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={addPalier}>
        <Plus className="h-3.5 w-3.5" /> Ajouter un palier
      </Button>
    </div>
  );
}
