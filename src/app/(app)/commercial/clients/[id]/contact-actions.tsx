"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { detacherContactEnB2C, setPrimaryContact, toggleContactStatus } from "../actions";
import { Star } from "lucide-react";

export function ContactActions({
  contactId,
  companyId,
  isPrimary,
  status,
  canDetach,
}: {
  contactId: string;
  companyId: string;
  isPrimary: boolean;
  status: "actif" | "inactif";
  /** Faux sur une fiche B2C : son contact ne peut pas être « détaché » d'elle-même. */
  canDetach: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDetach, setConfirmDetach] = useState(false);

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
      {!canDetach ? null : confirmDetach ? (
        <span className="flex items-center gap-2">
          <span className="text-foreground-muted">Devenir un client B2C ? Son compte portail le suit.</span>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await detacherContactEnB2C(contactId, companyId);
                if (res.error) toast.error("Détachement impossible", { description: res.error });
                else {
                  toast.success("Contact détaché : fiche client B2C");
                  router.push(`/commercial/clients/${res.b2cId}`);
                }
              })
            }
            className="font-medium text-brand hover:underline"
          >
            Confirmer
          </button>
          <button disabled={pending} onClick={() => setConfirmDetach(false)} className="font-medium text-foreground-muted hover:text-foreground">
            Annuler
          </button>
        </span>
      ) : (
        <button disabled={pending} onClick={() => setConfirmDetach(true)} className="font-medium text-foreground-muted hover:text-foreground">
          Détacher (client B2C)
        </button>
      )}
    </div>
  );
}
