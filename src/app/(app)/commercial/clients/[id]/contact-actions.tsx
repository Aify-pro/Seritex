"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setPrimaryContact, toggleContactStatus } from "../actions";
import { Star } from "lucide-react";

export function ContactActions({
  contactId,
  companyId,
  isPrimary,
  status,
}: {
  contactId: string;
  companyId: string;
  isPrimary: boolean;
  status: "actif" | "inactif";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3 text-xs">
      {!isPrimary && (
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await setPrimaryContact(contactId, companyId);
              if (res.error) toast.error(res.error);
              else toast.success("Contact principal mis à jour");
            })
          }
          className="flex items-center gap-1 font-medium text-foreground-muted hover:text-brand"
        >
          <Star className="h-3 w-3" /> Définir comme principal
        </button>
      )}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const next = status === "actif" ? "inactif" : "actif";
            const res = await toggleContactStatus(contactId, companyId, next);
            if (res.error) toast.error(res.error);
          })
        }
        className="font-medium text-foreground-muted hover:text-foreground"
      >
        {status === "actif" ? "Désactiver" : "Réactiver"}
      </button>
    </div>
  );
}
