"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteEncre, toggleEncreActive, updateEncre } from "../actions";
import { ConfirmDelete } from "../couleurs/confirm-delete";
import { EncreFields, type EncreRow } from "./encre-fields";

function EditEncreForm({ encre, onDone }: { encre: EncreRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateEncre(encre.id, formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Encre modifiée");
            onDone();
            router.refresh();
          }
        })
      }
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end gap-2">
        <EncreFields defaults={encre} />
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

/** Modifier, activer / désactiver, supprimer une encre (selon la matrice). */
export function EncreRowActions({ encre, canModify, canDelete }: { encre: EncreRow; canModify: boolean; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {canModify && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Modifier ${encre.nom}`}
            title="Modifier"
            className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <Dialog open={open} onOpenChange={setOpen} title="Modifier l'encre" size="lg">
            <EditEncreForm encre={encre} onDone={() => setOpen(false)} />
          </Dialog>
        </>
      )}
      {canDelete && (
        <ConfirmDelete
          label={encre.nom}
          description="L'encre est retirée du nuancier. Les films déjà téléchargés ne changent pas."
          onConfirm={() => deleteEncre(encre.id)}
        />
      )}
      <button
        type="button"
        disabled={pending || !canModify}
        onClick={() =>
          startTransition(async () => {
            const res = await toggleEncreActive(encre.id, !encre.active);
            if (res?.error) toast.error(res.error);
          })
        }
        className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
          encre.active ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
        }`}
      >
        {encre.active ? "Active" : "Inactive"}
      </button>
    </div>
  );
}
