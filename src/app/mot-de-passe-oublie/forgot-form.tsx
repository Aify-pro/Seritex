"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, MailCheck, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPasswordResetAction, type ForgotState } from "./actions";

export function ForgotForm({ linkExpired }: { linkExpired: boolean }) {
  const [state, formAction, pending] = useActionState<ForgotState, FormData>(requestPasswordResetAction, {});

  if (state.done) {
    return (
      <div className="space-y-4">
        <div role="status" className="flex items-start gap-3 rounded-md bg-success-soft px-3 py-3 text-sm text-success">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Si un compte actif correspond à cette adresse, un e-mail contenant un lien de réinitialisation vient
            d&apos;être envoyé. Pensez à vérifier vos courriers indésirables.
          </p>
        </div>
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {linkExpired && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Ce lien n&apos;est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau.
        </div>
      )}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-foreground">
          Adresse e-mail du compte
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="vous@entreprise.com"
            className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none ring-brand/30 transition-shadow focus:ring-2"
          />
        </div>
      </div>
      {state.error && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}
      <Button type="submit" className="w-full" loading={pending}>
        Envoyer le lien
      </Button>
      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour à la connexion
      </Link>
    </form>
  );
}
