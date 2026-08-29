"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addRoutingStep } from "../actions";
import { Plus } from "lucide-react";

export function AddStepForm({
  templateId,
  sections,
}: {
  templateId: string;
  sections: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Ajouter une étape
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await addRoutingStep(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Étape ajoutée");
            setOpen(false);
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="routing_template_id" value={templateId} />
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Section</label>
        <select name="section_id" required className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Durée standard (min)</label>
        <input
          name="standard_duration_minutes"
          type="number"
          min={1}
          className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        Ajouter
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Annuler
      </Button>
    </form>
  );
}
