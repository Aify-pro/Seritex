"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { createTextile } from "./actions";

export function NewTextileForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createTextile(formData);
          if (res?.error) toast.error("Création refusée", { description: res.error });
          else {
            toast.success("Textile créé");
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
          name="nom"
          required
          placeholder="Ex : Jersey 180g"
          className="h-9 w-44 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Composition</label>
        <input
          name="composition"
          placeholder="Ex : 100 % coton"
          className="h-9 w-40 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Grammage (g/m²)</label>
        <input
          name="grammage"
          type="number"
          min={0}
          step="0.1"
          className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Laize (cm)</label>
        <input
          name="laize_cm"
          type="number"
          min={0}
          step="0.1"
          className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Créer
      </Button>
    </form>
  );
}
