"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archiveProductionOrder, unarchiveProductionOrder } from "../actions";
import { Archive, ArchiveRestore } from "lucide-react";

/** Archive/désarchive un ordre de fabrication — n'apparaît que si l'utilisateur a le droit "Archiver" sur ce module. */
export function ArchiveButton({ productionOrderId, archived }: { productionOrderId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (archived) {
    return (
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await unarchiveProductionOrder(productionOrderId);
            if (res.error) toast.error(res.error);
            else toast.success("Ordre de fabrication désarchivé");
          })
        }
      >
        <ArchiveRestore className="h-3.5 w-3.5" /> Désarchiver
      </Button>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Archive className="h-3.5 w-3.5" /> Archiver
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await archiveProductionOrder(productionOrderId, formData.get("reason") as string);
          if (res.error) toast.error(res.error);
          else {
            toast.success("Ordre de fabrication archivé");
            setOpen(false);
          }
        })
      }
      className="flex items-center gap-2"
    >
      <input
        name="reason"
        placeholder="Raison (optionnel)"
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Confirmer
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Annuler
      </Button>
    </form>
  );
}
