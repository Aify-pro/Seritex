"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createSection } from "../actions";
import { Plus } from "lucide-react";

export function NewSectionForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createSection(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Section créée");
            formRef.current?.reset();
          }
        })
      }
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Nom</label>
        <input name="name" required className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div className="flex-1 min-w-[200px]">
        <label className="mb-1 block text-xs font-medium text-foreground">Description</label>
        <input name="description" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}
