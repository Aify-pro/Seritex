"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { upsertContact } from "../actions";
import type { Contact } from "@/lib/types/domain";
import { Plus, Pencil } from "lucide-react";

/** Formulaire d'ajout ou d'édition d'un contact CRM (section 2 de l'analyse, addendum v4). */
export function ContactForm({ companyId, contact }: { companyId: string; contact?: Contact }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant={contact ? "ghost" : "secondary"} onClick={() => setOpen(true)}>
        {contact ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {contact ? "" : "Nouveau contact"}
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await upsertContact(formData);
          if (res.error) toast.error(res.error);
          else {
            toast.success(contact ? "Contact mis à jour" : "Contact créé");
            setOpen(false);
          }
        })
      }
      className="col-span-full grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-muted/50 p-3 sm:grid-cols-2"
    >
      <input type="hidden" name="company_id" value={companyId} />
      {contact && <input type="hidden" name="contact_id" value={contact.id} />}
      <input
        name="first_name"
        required
        placeholder="Prénom"
        defaultValue={contact?.first_name ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        name="last_name"
        required
        placeholder="Nom"
        defaultValue={contact?.last_name ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        name="role_title"
        placeholder="Fonction (ex. Responsable achats)"
        defaultValue={contact?.role_title ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        name="department"
        placeholder="Service (optionnel)"
        defaultValue={contact?.department ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        name="email"
        type="email"
        placeholder="E-mail"
        defaultValue={contact?.email ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        name="phone"
        placeholder="Téléphone fixe"
        defaultValue={contact?.phone ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        name="mobile_phone"
        placeholder="Mobile"
        defaultValue={contact?.mobile_phone ?? ""}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <select
        name="preferred_channel"
        defaultValue={contact?.preferred_channel ?? "email"}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
      >
        <option value="email">Canal préféré : e-mail</option>
        <option value="telephone">Canal préféré : téléphone</option>
        <option value="whatsapp">Canal préféré : WhatsApp</option>
      </select>
      <textarea
        name="notes"
        placeholder="Notes (optionnel)"
        defaultValue={contact?.notes ?? ""}
        rows={2}
        className="col-span-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
      />
      <div className="col-span-full flex gap-2">
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
