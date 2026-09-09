"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createColor } from "../actions";
import { Plus } from "lucide-react";

export function NewColorForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createColor(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Couleur ajoutée");
            formRef.current?.reset();
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Nom</label>
        <input
          name="name"
          required
          placeholder="Ex : Bleu marine"
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Code</label>
        <input
          name="code"
          type="text"
          required
          placeholder="#1A2A4A"
          className="h-9 w-32 rounded-md border border-border bg-surface px-2 font-mono text-sm"
        />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}
