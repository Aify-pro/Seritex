"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateCompany } from "../actions";
import type { Company } from "@/lib/types/domain";
import { Pencil } from "lucide-react";

export function CompanyForm({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Modifier la fiche
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateCompany(formData);
          if (res.error) toast.error(res.error);
          else {
            toast.success("Fiche entreprise mise à jour");
            setOpen(false);
          }
        })
      }
      className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface-muted/50 p-4 sm:grid-cols-2"
    >
      <input type="hidden" name="company_id" value={company.id} />
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Raison sociale</label>
        <input name="name" required defaultValue={company.name} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">SIRET</label>
        <input name="siret" defaultValue={company.siret ?? ""} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Téléphone</label>
        <input name="phone" defaultValue={company.phone ?? ""} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">E-mail</label>
        <input name="email" type="email" defaultValue={company.email ?? ""} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-foreground">Adresse</label>
        <input name="address" defaultValue={company.address ?? ""} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-foreground">Notes CRM</label>
        <textarea name="notes" defaultValue={company.notes ?? ""} rows={2} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
