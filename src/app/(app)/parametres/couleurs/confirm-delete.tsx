"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Bouton de suppression avec confirmation. Le refus d'une suppression (élément
 * encore utilisé) vient de la base : son message est affiché tel quel.
 */
export function ConfirmDelete({
  label,
  description,
  onConfirm,
  iconOnly = true,
}: {
  label: string;
  description: string;
  onConfirm: () => Promise<{ error?: string }>;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    startTransition(async () => {
      const res = await onConfirm();
      if (res?.error) {
        toast.error("Suppression impossible", { description: res.error });
      } else {
        toast.success("Supprimé");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Supprimer ${label}`}
        title="Supprimer"
        className="rounded-md p-1 text-foreground-muted hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 className="h-4 w-4" />
        {!iconOnly && <span className="ml-1 text-xs">Supprimer</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={`Supprimer ${label} ?`} size="sm">
        <p className="text-sm text-foreground-muted">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button type="button" size="sm" variant="danger" loading={pending} onClick={confirm}>
            Supprimer
          </Button>
        </div>
      </Dialog>
    </>
  );
}
