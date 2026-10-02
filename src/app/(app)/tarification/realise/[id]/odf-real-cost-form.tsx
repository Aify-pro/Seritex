"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveOdfRealCost } from "../../actions";

/** Prix du tissu au kg propre à cet ODF (vide = prix du textile) et notes (migration 0070). */
export function OdfRealCostForm({ odfId, prixKgOdf, notes, textilePlaceholder }: { odfId: string; prixKgOdf: number | null; notes: string | null; textilePlaceholder: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prix, setPrix] = useState(prixKgOdf === null ? "" : String(prixKgOdf));
  const [texte, setTexte] = useState(notes ?? "");

  return (
    <div className="space-y-3">
      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-medium text-foreground">Prix du tissu au kg pour cet ODF (F CFA, rendu)</span>
        <input
          inputMode="decimal"
          value={prix}
          placeholder={textilePlaceholder}
          disabled={pending}
          onChange={(e) => setPrix(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
        <span className="mt-1 block text-xs text-foreground-muted">Vide : prix du textile (Tarification).</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground">Notes (facture fournisseur, explication d&apos;un écart…)</span>
        <textarea
          value={texte}
          rows={2}
          disabled={pending}
          onChange={(e) => setTexte(e.target.value)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </label>
      <Button
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const raw = prix.trim();
            const res = await saveOdfRealCost(odfId, { prix_tissu_kg: raw === "" ? null : Number(raw.replace(",", ".")), notes: texte });
            if (res.error) toast.error("Non enregistré", { description: res.error });
            else {
              toast.success("Analyse mise à jour");
              router.refresh();
            }
          })
        }
      >
        Enregistrer
      </Button>
    </div>
  );
}
