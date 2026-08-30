"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createUserAccount } from "../actions";
import { ROLE_LABELS, type UserRole } from "@/lib/types/domain";
import { KeyRound, Plus } from "lucide-react";

const ROLES = Object.keys(ROLE_LABELS) as UserRole[];

export function NewUserForm({
  companies,
  sections,
  contacts,
}: {
  companies: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  contacts: { id: string; company_id: string; first_name: string; last_name: string }[];
}) {
  const [role, setRole] = useState<UserRole>("commercial");
  const [companyId, setCompanyId] = useState("");
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [open, setOpen] = useState(false);

  const contactsForCompany = contacts.filter((c) => c.company_id === companyId);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nouvel utilisateur
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted/50 p-4">
      <form
        action={(formData) =>
          startTransition(async () => {
            const res = await createUserAccount(formData);
            if (res.error) toast.error(res.error);
            else {
              toast.success("Compte créé");
              setCredentials({ email: res.email!, tempPassword: res.tempPassword! });
            }
          })
        }
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Nom complet</label>
          <input name="full_name" required className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">E-mail</label>
          <input name="email" type="email" required className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Rôle</label>
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {role === "client" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Entreprise</label>
            <select
              name="company_id"
              required
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {role === "client" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Contact (fiche CRM)</label>
            <select
              name="contact_id"
              required
              disabled={!companyId}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-50"
            >
              <option value="">—</option>
              {contactsForCompany.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </select>
            {companyId && contactsForCompany.length === 0 && (
              <p className="mt-1 text-xs text-warning">
                Aucun contact pour cette entreprise — créez-le d&apos;abord depuis Clients.
              </p>
            )}
          </div>
        )}
        {role === "chef_section" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Section</label>
            <select name="section_id" required className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">—</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="col-span-full flex gap-2">
          <Button type="submit" size="sm" loading={pending}>
            Créer le compte
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </div>
      </form>

      {credentials && (
        <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Compte <strong>{credentials.email}</strong> créé avec le mot de passe temporaire{" "}
            <code className="rounded bg-surface px-1">{credentials.tempPassword}</code> — à transmettre à
            l&apos;utilisateur par un canal sécurisé ; recommandez-lui de le changer dès sa première connexion.
          </span>
        </div>
      )}
    </div>
  );
}
