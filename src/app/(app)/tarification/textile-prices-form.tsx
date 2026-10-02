"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveTextilePrice } from "./actions";

/**
 * Prix du tissu au kg, rendu (douane comprise), par textile (migration 0070) —
 * valeur par défaut du prix de revient réel des ODF, ajustable ODF par ODF
 * (famille de couleur différente, nouveau prix fournisseur…).
 */
export function TextilePricesForm({ textiles }: { textiles: { id: string; nom: string; grammage: number | null; prixKg: number | null }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(textiles.map((t) => [t.id, t.prixKg === null ? "" : String(t.prixKg)])));

  if (textiles.length === 0) return <p className="text-sm text-foreground-muted">Aucun textile actif — Paramètres &gt; Textiles.</p>;

  function save(id: string) {
    const raw = values[id].trim();
    const prix = raw === "" ? null : Number(raw.replace(",", "."));
    startTransition(async () => {
      const res = await saveTextilePrice(id, prix);
      if (res.error) toast.error("Prix non enregistré", { description: res.error });
      else {
        toast.success("Prix au kg enregistré");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {textiles.map((t) => {
        const initial = t.prixKg === null ? "" : String(t.prixKg);
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-3">
            <p className="w-56 text-sm text-foreground">
              {t.nom}
              {t.grammage ? <span className="text-foreground-muted"> · {t.grammage} g/m²</span> : null}
            </p>
            <input
              inputMode="decimal"
              value={values[t.id]}
              placeholder="F CFA / kg"
              disabled={pending}
              onChange={(e) => setValues({ ...values, [t.id]: e.target.value })}
              className="h-9 w-32 rounded-md border border-border bg-surface px-2 text-right text-sm"
            />
            {values[t.id] !== initial && (
              <Button size="sm" loading={pending} onClick={() => save(t.id)}>
                Enregistrer
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
