"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, KeyRound, MailPlus, ShieldAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendUserInvitation, sendUserPasswordReset, setMustChangePassword, setUserActive } from "../actions";

/**
 * Actions d'accès d'un compte. Les actions destructives (désactiver) demandent
 * confirmation ; celles qui envoient un e-mail disent clairement à qui.
 */
export function AccessPanel({
  userId,
  fullName,
  email,
  active,
  neverSignedIn,
  mustChangePassword,
  isSelf,
}: {
  userId: string;
  fullName: string;
  email: string;
  active: boolean;
  neverSignedIn: boolean;
  mustChangePassword: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ error?: string; sent?: boolean }>, success: string) {
    startTransition(async () => {
      const res = await task();
      if (res.error) toast.error(res.error);
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {active && (
        <>
          {neverSignedIn ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              className="w-full justify-start"
              onClick={() => run(() => resendUserInvitation(userId), `Invitation renvoyée à ${email}`)}
            >
              <MailPlus className="h-3.5 w-3.5" /> Renvoyer l&apos;invitation
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              className="w-full justify-start"
              onClick={() => run(() => sendUserPasswordReset(userId), `Lien de réinitialisation envoyé à ${email}`)}
            >
              <KeyRound className="h-3.5 w-3.5" /> Envoyer un lien de réinitialisation
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            className="w-full justify-start"
            onClick={() =>
              run(
                () => setMustChangePassword(userId, !mustChangePassword),
                mustChangePassword ? "Exigence levée" : "Nouveau mot de passe exigé à la prochaine connexion"
              )
            }
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {mustChangePassword ? "Ne plus exiger de nouveau mot de passe" : "Exiger un nouveau mot de passe à la prochaine connexion"}
          </Button>
        </>
      )}

      {isSelf && active ? (
        <p className="text-xs text-foreground-muted">Vous ne pouvez pas désactiver votre propre compte.</p>
      ) : active ? (
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          className="w-full justify-start"
          onClick={() => {
            if (window.confirm(`Désactiver le compte de ${fullName} ? Il ne pourra plus se connecter et sera prévenu par e-mail.`)) {
              run(() => setUserActive(userId, false), "Compte désactivé");
            }
          }}
        >
          <Ban className="h-3.5 w-3.5" /> Désactiver le compte
        </Button>
      ) : (
        <Button
          variant="success"
          size="sm"
          disabled={pending}
          className="w-full justify-start"
          onClick={() => run(() => setUserActive(userId, true), "Compte réactivé")}
        >
          <UserCheck className="h-3.5 w-3.5" /> Réactiver le compte
        </Button>
      )}
    </div>
  );
}
