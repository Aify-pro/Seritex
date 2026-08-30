"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteSampleRequest } from "@/lib/actions/samples";

/**
 * Suppression avec confirmation en deux temps (plutôt qu'un `window.confirm`
 * natif, pour rester dans le style de l'application). N'est rendu par
 * l'appelant que si la fiche n'est pas attribuée à un ordre de fabrication
 * et que l'utilisateur courant a le droit de supprimer (section 3.6).
 */
export function DeleteSampleButton({ sampleId, onDeleted }: { sampleId: string; onDeleted?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Supprimer
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5">
      <span className="text-xs font-medium text-danger">Supprimer définitivement cette fiche ?</span>
      <Button
        variant="danger"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteSampleRequest(sampleId);
            if (res?.error) {
              toast.error(res.error);
              setConfirming(false);
            } else {
              toast.success("Fiche supprimée");
              onDeleted?.();
            }
          })
        }
      >
        Confirmer
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Annuler
      </Button>
    </div>
  );
}
