"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteMediaFile } from "@/lib/actions/media";
import { Trash2 } from "lucide-react";

/**
 * Suppression d'un fichier médiathèque — n'apparaît que si l'utilisateur a
 * le droit "Supprimer" sur le module Médiathèque (matrice Paramètres > Rôles
 * & permissions, voir `canDelete` calculé côté serveur) ; raison obligatoire,
 * même logique que le dépôt/la mise à jour d'un fichier.
 */
export function DeleteMediaFileForm({ mediaFileId, companyId }: { mediaFileId: string; companyId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs font-medium text-danger hover:underline"
      >
        <Trash2 className="h-3 w-3" /> Supprimer
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await deleteMediaFile(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Fichier supprimé");
            setOpen(false);
          }
        })
      }
      className="mt-2 space-y-2 rounded-md border border-danger/30 bg-danger-soft/40 p-2.5"
    >
      <input type="hidden" name="media_file_id" value={mediaFileId} />
      <input type="hidden" name="company_id" value={companyId} />
      <input
        name="reason"
        required
        minLength={3}
        placeholder="Raison de la suppression (obligatoire)"
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" loading={pending}>
          Confirmer la suppression
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
