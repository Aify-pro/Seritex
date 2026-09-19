"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, MailCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createUserAccount, type CreateUserResult } from "./actions";
import { UserFields, type RoleOption } from "./user-fields";

export function NewUserForm({
  roles,
  companies,
  sections,
  contacts,
}: {
  roles: RoleOption[];
  companies: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  contacts: { id: string; company_id: string; first_name: string; last_name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CreateUserResult | null>(null);
  // Remonté à chaque succès pour vider le formulaire (les champs sont non contrôlés).
  const [formKey, setFormKey] = useState(0);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nouvel utilisateur
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-lg border border-border bg-surface-muted/50 p-4 sm:max-w-2xl">
      <form
        key={formKey}
        action={(formData) =>
          startTransition(async () => {
            const res = await createUserAccount(formData);
            if (res.error) {
              toast.error(res.error);
              return;
            }
            toast.success("Compte créé");
            setResult(res);
            setFormKey((k) => k + 1);
            router.refresh();
          })
        }
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <UserFields roles={roles} companies={companies} sections={sections} contacts={contacts} />
        <label className="col-span-full flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" name="send_invitation" defaultChecked className="mt-0.5" />
          <span>
            Envoyer une invitation par e-mail
            <span className="block text-xs text-foreground-muted">
              L&apos;utilisateur choisit lui-même son mot de passe. Sinon, un mot de passe provisoire vous est remis.
            </span>
          </span>
        </label>
        <div className="col-span-full flex gap-2">
          <Button type="submit" size="sm" loading={pending}>
            Créer le compte
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </div>
      </form>

      {result?.invited && (
        <div className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-xs text-success" role="status">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Invitation envoyée à <strong>{result.email}</strong>. Tant qu&apos;elle n&apos;a pas été utilisée, le compte
            apparaît « Invitation en attente » ; vous pouvez la renvoyer depuis sa fiche.
          </span>
        </div>
      )}
      {result?.tempPassword && (
        <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info" role="status">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Aucun e-mail n&apos;est parti (invitation décochée ou envoi d&apos;e-mails non disponible). Compte{" "}
            <strong>{result.email}</strong> créé avec le mot de passe provisoire{" "}
            <code className="rounded bg-surface px-1">{result.tempPassword}</code> — à transmettre par un canal sécurisé.
            L&apos;utilisateur devra en choisir un nouveau dès sa première connexion.
          </span>
        </div>
      )}
    </div>
  );
}
