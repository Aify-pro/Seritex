"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { addNotificationRecipient, removeNotificationRecipient } from "./actions";

export type RecipientView = { id: string; kind: "user" | "role" | "responsable_dossier" | "contact_client"; user_id: string | null; role_key: string | null };
export type UserChoice = { id: string; full_name: string; email: string };
export type RoleChoice = { key: string; label: string };

const FIXES: Record<string, string> = {
  responsable_dossier: "Commercial en charge du dossier",
  contact_client: "Contact du client",
};

/**
 * Destinataires d'un événement : personnes précises, rôle entier (ex. Direction), commercial en charge du
 * dossier, contact du client. Aucune ligne = comportement par défaut de l'événement.
 */
export function EventRecipients({
  eventKey,
  recipients,
  users,
  roles,
}: {
  eventKey: string;
  recipients: RecipientView[];
  users: UserChoice[];
  roles: RoleChoice[];
}) {
  const [pending, startTransition] = useTransition();
  const [choix, setChoix] = useState("");

  const nom = (r: RecipientView) =>
    r.kind === "user"
      ? (users.find((u) => u.id === r.user_id)?.full_name ?? "Utilisateur désactivé ou supprimé")
      : r.kind === "role"
        ? `Rôle : ${roles.find((x) => x.key === r.role_key)?.label ?? r.role_key}`
        : FIXES[r.kind];

  const deja = new Set(recipients.map((r) => (r.kind === "user" ? `user:${r.user_id}` : r.kind === "role" ? `role:${r.role_key}` : r.kind)));
  const options: { value: string; label: string }[] = [
    ...Object.entries(FIXES).map(([k, l]) => ({ value: k, label: l })),
    ...roles.map((r) => ({ value: `role:${r.key}`, label: `Rôle : ${r.label}` })),
    ...users.map((u) => ({ value: `user:${u.id}`, label: `${u.full_name} (${u.email})` })),
  ].filter((o) => !deja.has(o.value));

  function ajouter(valeur: string) {
    if (!valeur) return;
    const [kind, ref] = valeur.split(":");
    startTransition(async () => {
      const res = await addNotificationRecipient(eventKey, ref ? { kind, ref } : { kind });
      if (res?.error) toast.error(res.error);
      setChoix("");
    });
  }

  return (
    <div className="space-y-2 rounded-md bg-surface-muted/60 p-3">
      <p className="text-xs font-medium text-foreground">Destinataires</p>
      {recipients.length === 0 ? (
        <p className="text-xs text-foreground-muted">Aucun réglage : l&apos;événement suit son comportement par défaut.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {recipients.map((r) => (
            <li key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs">
              {nom(r)}
              <button
                type="button"
                disabled={pending}
                aria-label={`Retirer ${nom(r)}`}
                onClick={() =>
                  startTransition(async () => {
                    const res = await removeNotificationRecipient(r.id);
                    if (res?.error) toast.error(res.error);
                  })
                }
                className="rounded-full p-0.5 text-foreground-muted hover:text-danger disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        aria-label="Ajouter un destinataire"
        value={choix}
        disabled={pending || options.length === 0}
        onChange={(e) => {
          setChoix(e.target.value);
          ajouter(e.target.value);
        }}
        className="h-9 w-full max-w-md rounded-md border border-border bg-surface px-2 text-sm"
      >
        <option value="">+ Ajouter un destinataire…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
