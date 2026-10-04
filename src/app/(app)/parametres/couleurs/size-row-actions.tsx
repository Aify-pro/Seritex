"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteSize, updateSize } from "../actions";
import { ConfirmDelete } from "./confirm-delete";

type SizeRow = { id: string; groupe: string; libelle: string; display_order: number };

const inputClass = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

function EditSizeForm({ size, groupes, onDone }: { size: SizeRow; groupes: string[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateSize(size.id, formData);
          if (res?.error) toast.error("Modification refusée", { description: res.error });
          else {
            toast.success("Taille modifiée");
            onDone();
            router.refresh();
          }
        })
      }
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Groupe</label>
          <input name="groupe" required list="groupes-tailles-edit" defaultValue={size.groupe} className={`${inputClass} w-36`} />
          <datalist id="groupes-tailles-edit">
            {groupes.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Taille</label>
          <input name="libelle" required defaultValue={size.libelle} className={`${inputClass} w-36`} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Ordre</label>
          <input name="display_order" type="number" min={0} defaultValue={size.display_order} className={`${inputClass} w-20`} />
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        Une taille déjà utilisée (ODF, devis, grilles de prix…) ne peut plus changer de groupe ni de libellé : seul son
        ordre reste modifiable.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onDone} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

/** Modifier / supprimer une taille. La suppression est réservée à l'administrateur. */
export function SizeRowActions({ size, groupes, canDelete }: { size: SizeRow; groupes: string[]; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Modifier la taille ${size.groupe}/${size.libelle}`}
        title="Modifier"
        className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Modifier la taille" size="md">
        <EditSizeForm size={size} groupes={groupes} onDone={() => setOpen(false)} />
      </Dialog>
      {canDelete && (
        <ConfirmDelete
          label={`${size.groupe}/${size.libelle}`}
          description="La taille est supprimée définitivement. Si elle est utilisée (ODF, devis, grilles de prix, dispatching…), la suppression est refusée : désactivez-la plutôt."
          onConfirm={() => deleteSize(size.id)}
        />
      )}
    </div>
  );
}
