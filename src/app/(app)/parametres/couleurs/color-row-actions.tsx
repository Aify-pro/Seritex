"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteColor, updateColor } from "../actions";
import { ColorFields } from "./color-fields";
import { ConfirmDelete } from "./confirm-delete";

type ColorRow = { id: string; name: string; code: string; hex: string | null; famille: string | null };

function EditColorForm({ color, onDone }: { color: ColorRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateColor(color.id, formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Couleur modifiée");
            onDone();
            router.refresh();
          }
        })
      }
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end gap-2">
        <ColorFields defaults={color} />
      </div>
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

/** Modifier / supprimer une couleur. La suppression est réservée à l'administrateur. */
export function ColorRowActions({ color, canDelete }: { color: ColorRow; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Modifier ${color.name}`}
        title="Modifier"
        className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Modifier la couleur" size="lg">
        <EditColorForm color={color} onDone={() => setOpen(false)} />
      </Dialog>
      {canDelete && (
        <ConfirmDelete
          label={color.name}
          description="La couleur est supprimée définitivement. Si elle est utilisée (modèle, devis, ODF…), la suppression est refusée : désactivez-la plutôt."
          onConfirm={() => deleteColor(color.id)}
        />
      )}
    </div>
  );
}
