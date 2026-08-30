"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addMediaFileVersion } from "@/lib/actions/media";
import { RefreshCw } from "lucide-react";

/** Mise à jour d'un fichier existant (nouvelle version) — raison obligatoire, l'ancienne version reste conservée. */
export function AddVersionForm({ mediaFileId }: { mediaFileId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <RefreshCw className="h-3 w-3" /> Mettre à jour
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await addMediaFileVersion(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Nouvelle version enregistrée");
            formRef.current?.reset();
            setOpen(false);
          }
        })
      }
      className="mt-2 space-y-2 rounded-md border border-border bg-surface-muted/50 p-2.5"
    >
      <input type="hidden" name="media_file_id" value={mediaFileId} />
      <input name="file" type="file" required className="block text-xs" />
      <input
        name="reason"
        required
        minLength={4}
        placeholder="Raison de la mise à jour (obligatoire)"
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
