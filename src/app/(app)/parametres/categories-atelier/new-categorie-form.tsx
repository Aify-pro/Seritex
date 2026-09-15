"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createAtelierCategorie } from "../actions";
import { Plus } from "lucide-react";

export function NewCategorieForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createAtelierCategorie(formData);
          if (res?.error) toast.error("Création refusée", { description: res.error });
          else {
            toast.success("Catégorie créée");
            formRef.current?.reset();
          }
        })
      }
      className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Nom</label>
        <input
          name="nom"
          required
          placeholder="Ex : Coupe"
          className="h-9 w-40 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Clé</label>
        <input
          name="cle"
          required
          placeholder="Ex : coupe"
          pattern="[a-z0-9_]+"
          title="Minuscules, chiffres et underscores uniquement"
          className="h-9 w-32 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs text-foreground">
        <input type="checkbox" name="requiert_fiche_trace" className="h-3.5 w-3.5" />
        Exige une fiche de tracé
      </label>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs text-foreground">
        <input type="checkbox" name="requiert_visuel" className="h-3.5 w-3.5" />
        Exige un visuel
      </label>
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}
