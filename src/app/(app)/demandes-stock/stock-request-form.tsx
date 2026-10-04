"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createStockProductionOrder, createStockRequest, type StockLine } from "./actions";

export interface ModelOption {
  id: string;
  name: string;
  colors: { id: string; name: string }[];
  sizes: { cle: string; libelle: string }[];
}

const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

/** Nouvelle demande pour le stock : articles (modèle, couleur) et quantités par taille. */
export function StockRequestForm({ models }: { models: ModelOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<StockLine[]>([]);

  const update = (i: number, patch: Partial<StockLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Object.values(l.tailles).reduce((t, q) => t + (q || 0), 0), 0);

  function submit() {
    startTransition(async () => {
      const res = await createStockRequest(description, lines);
      if (res.error) toast.error("Demande refusée", { description: res.error });
      else {
        toast.success("Demande pour le stock créée");
        setDescription("");
        setLines([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Motif (réassort de t-shirts blancs, préparation de la saison…)"
        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
      />
      {lines.map((l, i) => {
        const m = models.find((x) => x.id === l.product_model_id);
        return (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={l.product_model_id}
                onChange={(e) => {
                  const mm = models.find((x) => x.id === e.target.value);
                  update(i, { product_model_id: e.target.value, description: mm?.name ?? "", couleur_unique_id: null, tailles: {} });
                }}
                className={input}
              >
                <option value="">Modèle…</option>
                {models.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              {m && (
                <select value={l.couleur_unique_id ?? ""} onChange={(e) => update(i, { couleur_unique_id: e.target.value || null })} className={input}>
                  <option value="">Couleur…</option>
                  {m.colors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Désignation" className={`${input} w-56`} />
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-foreground-muted hover:text-danger" aria-label="Retirer">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {m && (
              <div className="flex flex-wrap gap-2">
                {m.sizes.map((s) => (
                  <label key={s.cle} className="flex w-16 flex-col items-center gap-1 text-[11px] text-foreground-muted">
                    {s.libelle}
                    <input
                      type="number"
                      min={0}
                      value={l.tailles[s.cle] || ""}
                      onChange={(e) => update(i, { tailles: { ...l.tailles, [s.cle]: Math.max(0, Math.floor(Number(e.target.value))) } })}
                      className="h-8 w-16 rounded-md border border-border bg-surface px-1 text-center text-sm text-foreground"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, { product_model_id: "", description: "", couleur_unique_id: null, tailles: {} }])}>
          <Plus className="h-3.5 w-3.5" /> Article
        </Button>
        <Button size="sm" loading={pending} disabled={total === 0} onClick={submit}>
          Créer la demande ({total} pièce{total > 1 ? "s" : ""})
        </Button>
      </div>
    </div>
  );
}

/** Crée l'ODF de stock (brouillon) depuis une demande. */
export function CreateStockOdfButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createStockProductionOrder(requestId);
          if (res.error) toast.error("ODF non créé", { description: res.error });
          else {
            toast.success("ODF de stock créé en brouillon");
            router.push(`/atelier/production/${res.id}`);
          }
        })
      }
    >
      Créer l&apos;ODF de stock
    </Button>
  );
}
