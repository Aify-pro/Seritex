"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { signInAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { AlertCircle, Lock, Mail } from "lucide-react";

const initialState: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <h2 className="text-xl font-semibold text-foreground">Connexion</h2>
      <p className="mt-1 text-sm text-foreground-muted">
        Accédez à votre espace Seritex avec vos identifiants.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-foreground">
            Adresse e-mail
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

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-foreground">
            Mot de passe
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none ring-brand/30 transition-shadow focus:ring-2"
            />
          </div>
        </div>

        {state?.error && (
          <div className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {state.error}
          </div>
        )}

        <Button type="submit" className="w-full" loading={pending}>
          Se connecter
        </Button>
      </form>

      <div className="mt-8 rounded-md border border-dashed border-border bg-surface-muted p-3 text-xs text-foreground-muted">
        <p className="font-medium text-foreground">Environnement de démonstration</p>
        <p className="mt-1">
          Comptes de test (mot de passe <code className="rounded bg-surface px-1">Seritex2026!</code>) :
          admin@seritex.local, commercial@seritex.local, production@seritex.local,
          coupe@seritex.local, client@ivoiresport.example…
        </p>
      </div>
    </motion.div>
  );
}
