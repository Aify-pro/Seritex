"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createColor } from "../actions";
import { Plus } from "lucide-react";
import { ColorFields } from "./color-fields";

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
      <ColorFields />
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}
