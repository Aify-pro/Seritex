"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createRoutingTemplate } from "../actions";
import { Plus } from "lucide-react";

export function NewTemplateForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createRoutingTemplate(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Gamme créée");
            formRef.current?.reset();
            router.refresh();
          }
        })
      }
      className="flex items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-foreground">Nouvelle gamme opératoire</label>
        <input
          name="name"
          required
          placeholder="Ex : T-shirt brodé sans sérigraphie"
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Créer
      </Button>
    </form>
  );
}
