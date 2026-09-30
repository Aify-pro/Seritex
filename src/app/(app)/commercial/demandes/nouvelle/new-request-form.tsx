"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/clients/company-picker";
import { listCompanyContacts, type CompanyContactOption, type CompanySearchResult } from "@/lib/actions/companies";
import { createRequest } from "../../actions";

/**
 * L'entreprise se cherche par saisie (plusieurs milliers de clients importés de
 * Sage : un menu déroulant serait tronqué) ; ses contacts sont chargés à la
 * sélection.
 */
export function NewRequestForm() {
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [contacts, setContacts] = useState<CompanyContactOption[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function onCompanyChange(c: CompanySearchResult | null) {
    setCompany(c);
    setContacts([]);
    if (c) setContacts(await listCompanyContacts(c.id));
  }

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
        <CompanyPicker name="company_id" required onChange={onCompanyChange} />
      </div>

      {contacts.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Contact</label>
          <select name="contact_id" className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm">
            <option value="">—</option>
            {contacts.map((c) => (
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

      <Button type="submit" loading={pending} disabled={!company}>
        Créer la demande
      </Button>
    </form>
  );
}
