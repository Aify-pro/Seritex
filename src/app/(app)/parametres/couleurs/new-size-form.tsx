"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSize } from "../actions";
import { Plus } from "lucide-react";

/**
 * Ajout d'une taille au référentiel. Le groupe est une saisie libre avec
 * suggestions plutôt qu'une liste fermée : les gammes évoluent, et une liste
 * fermée obligerait à une migration à chaque nouvelle.
 */
export function NewSizeForm({ groupes }: { groupes: string[] }) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createSize(formData);
          if (res?.error) toast.error("Ajout refusé", { description: res.error });
          else {
            toast.success("Taille ajoutée");
            formRef.current?.reset();
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Groupe</label>
        <input
          name="groupe"
          required
          list="groupes-tailles"
          placeholder="Ex : Homme"
          className="h-9 w-36 rounded-md border border-border bg-surface px-2 text-sm"
        />
        <datalist id="groupes-tailles">
          {groupes.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Taille</label>
        <input
          name="libelle"
          required
          placeholder="Ex : 7XL, 42, 8 ans"
          className="h-9 w-36 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Ordre</label>
        <input
          name="display_order"
          type="number"
          min={0}
          defaultValue={0}
          title="Position dans la grille : XS avant S avant M. L'ordre alphabétique ne convient pas."
          className="h-9 w-20 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}
