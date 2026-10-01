"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateQuoteLineSizes } from "@/app/(app)/commercial/actions";
import { dispatchGap, type Dispatch } from "@/lib/dispatching";
import { DispatchEditor, type SizeOption } from "./dispatch-editor";

/**
 * Répartition par taille d'une ligne de devis sur la fiche devis (migration
 * 0066). En lecture : les tailles et leurs quantités, dans l'ordre métier.
 * Modifiable quand le devis est envoyé et pas encore accepté : le client
 * l'ajuste avant d'accepter (ou le commercial à sa demande), total fixe ;
 * la base trace la modification.
 */
export function QuoteLineDispatch({
  quoteId,
  quoteLineId,
  sizes,
  initial,
  quantity,
  editable,
}: {
  quoteId: string;
  quoteLineId: string;
  sizes: SizeOption[];
  initial: Dispatch;
  quantity: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<Dispatch>(initial);

  const ordered = sizes.filter((s) => (initial[s.cle] ?? 0) > 0);
  // Taille hors des options (modèle désactivé…) : affichée quand même, par sa clé.
  const others = Object.keys(initial).filter((cle) => !sizes.some((s) => s.cle === cle));

  if (!editing) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
        <span className="font-medium text-foreground">Répartition :</span>
        {ordered.length + others.length === 0 ? (
          <span>non renseignée</span>
        ) : (
          <>
            {ordered.map((s) => (
              <span key={s.cle}>
                {s.libelle} <span className="font-medium text-foreground">{initial[s.cle]}</span>
              </span>
            ))}
            {others.map((cle) => (
              <span key={cle}>
                {cle.split("/").pop()} <span className="font-medium text-foreground">{initial[cle]}</span>
              </span>
            ))}
          </>
        )}
        {editable && (
          <button
            type="button"
            onClick={() => {
              setValue(initial);
              setEditing(true);
            }}
            className="font-medium text-brand hover:underline"
          >
            Modifier la répartition
          </button>
        )}
      </div>
    );
  }

  const complete = dispatchGap(value, quantity) === 0;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border p-2">
      <DispatchEditor sizes={sizes} value={value} onChange={setValue} quantity={quantity} disabled={pending} />
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={pending}
          disabled={!complete}
          onClick={() =>
            startTransition(async () => {
              const res = await updateQuoteLineSizes(quoteId, quoteLineId, value);
              if (res.error) {
                toast.error("Répartition non enregistrée", { description: res.error });
                return;
              }
              toast.success("Répartition enregistrée");
              setEditing(false);
              router.refresh();
            })
          }
        >
          Enregistrer la répartition
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
