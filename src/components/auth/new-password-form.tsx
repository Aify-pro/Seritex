"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Circle, Eye, EyeOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkPassword } from "@/lib/auth/password";

export type PasswordFormState = { error?: string; success?: boolean };

const inputClass =
  "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-10 text-sm outline-none ring-brand/30 transition-shadow focus:ring-2";

function PasswordInput({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-muted hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Formulaire « choisir un mot de passe », partagé par la réinitialisation par
 * lien (sans mot de passe actuel) et Mon compte > Sécurité (avec). Les critères
 * sont un confort ; la vérification qui fait foi est refaite par l'action serveur.
 */
export function NewPasswordForm({
  action,
  requireCurrent = false,
  submitLabel,
  successMessage,
}: {
  action: (prev: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
  requireCurrent?: boolean;
  submitLabel: string;
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const checks = checkPassword(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = checks.every((c) => c.ok) && confirm === password;

  return (
    <form action={formAction} className="space-y-4">
      {requireCurrent && (
        <PasswordInput id="current_password" name="current_password" label="Mot de passe actuel" autoComplete="current-password" />
      )}
      <PasswordInput
        id="password"
        name="password"
        label="Nouveau mot de passe"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
      />
      <ul className="space-y-1 text-xs" aria-live="polite">
        {checks.map((c) => (
          <li key={c.label} className={`flex items-center gap-1.5 ${c.ok ? "text-success" : "text-foreground-muted"}`}>
            {c.ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {c.label}
          </li>
        ))}
      </ul>
      <PasswordInput
        id="confirm"
        name="confirm"
        label="Confirmer le nouveau mot de passe"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
      />
      {mismatch && <p className="text-xs text-danger">Les deux mots de passe ne correspondent pas.</p>}

      {state.error && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}
      {state.success && successMessage && (
        <div role="status" className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          <Check className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}

      <Button type="submit" className="w-full" loading={pending} disabled={!ready}>
        {submitLabel}
      </Button>
    </form>
  );
}
