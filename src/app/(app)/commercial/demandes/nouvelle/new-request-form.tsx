"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createRequest } from "../../actions";

type Company = { id: string; name: string };
type Contact = { id: string; company_id: string; first_name: string; last_name: string };

export function NewRequestForm({ companies, contacts }: { companies: Company[]; contacts: Contact[] }) {
  const [companyId, setCompanyId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const filteredContacts = contacts.filter((c) => c.company_id === companyId);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await createRequest(formData);
          if (res.error) toast.error(res.error);
          else {
            toast.success("Demande créée");
            router.push(`/commercial/demandes/${res.requestId}`);
          }
        })
      }
      className="max-w-xl space-y-4"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Entreprise</label>
        <select
          name="company_id"
          required
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">— Sélectionner —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {filteredContacts.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Contact</label>
          <select name="contact_id" className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm">
            <option value="">—</option>
            {filteredContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Description du besoin</label>
        <textarea
          name="description"
          required
          rows={4}
          className="w-full rounded-md border border-border bg-surface p-3 text-sm"
          placeholder="Ex : 300 polos brodés logo, taille S à XL, livraison sous 3 semaines..."
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" name="needs_graphics" className="h-4 w-4 rounded border-border" />
        Nécessite une intervention graphique (visuel à préparer)
      </label>

      <Button type="submit" loading={pending}>
        Créer la demande
      </Button>
    </form>
  );
}
