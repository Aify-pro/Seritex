"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateTextile } from "./actions";

const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70";

/** Caractéristiques d'un textile : nom, composition, grammage, laize. */
export function TextileForm({
  textile,
  editable,
}: {
  textile: { id: string; nom: string; composition: string | null; grammage: number | null; laize_cm: number | null };
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateTextile(textile.id, formData);
          if (res?.error) toast.error("Enregistrement refusé", { description: res.error });
          else {
            toast.success("Textile enregistré");
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-3"
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Nom</span>
        <input name="nom" defaultValue={textile.nom} required disabled={!editable} className={`${input} w-56`} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Composition</span>
        <input name="composition" defaultValue={textile.composition ?? ""} disabled={!editable} className={`${input} w-48`} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Grammage (g/m²)</span>
        <input name="grammage" type="number" step="any" defaultValue={textile.grammage ?? ""} disabled={!editable} className={`${input} w-28`} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Laize (cm)</span>
        <input name="laize_cm" type="number" step="any" defaultValue={textile.laize_cm ?? ""} disabled={!editable} className={`${input} w-24`} />
      </label>
      {editable && (
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
      )}
    </form>
  );
}
