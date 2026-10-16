"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { viderTamponMaintenant } from "@/lib/actions/media";

/** Lance tout de suite le déplacement tampon → stockage (la tâche planifiée le fait aussi, toutes les 5 minutes). */
export function ViderTamponButton({ enAttente }: { enAttente: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
      <p className="text-foreground">
        {enAttente} fichier{enAttente > 1 ? "s" : ""} en attente dans le tampon.
      </p>
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await viderTamponMaintenant();
            if (res.deplaces > 0 && res.restants === 0) toast.success(`${res.deplaces} fichier(s) déplacé(s) vers le stockage`);
            else if (res.deplaces > 0) toast.warning(`${res.deplaces} déplacé(s), ${res.restants} encore en attente`, { description: res.message });
            else toast.error("Aucun fichier déplacé", { description: res.message ?? "Le stockage ne répond pas.", duration: 12000 });
          })
        }
      >
        <ArrowRightLeft className="h-3.5 w-3.5" /> Vider maintenant
      </Button>
    </div>
  );
}
