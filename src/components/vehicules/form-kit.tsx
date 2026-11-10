"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Briques de formulaire du module Véhicules : un formulaire qui appelle une
 * action serveur, affiche le résultat (toast) et rafraîchit la page ; la même
 * chose dans une fenêtre ; un bouton d'action simple. Les actions renvoient
 * `{ error?: string }`.
 */

type ActionResult = { error?: string } | undefined | void;

export const inputClass = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-foreground-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-foreground-muted">{hint}</span>}
    </label>
  );
}

export function ActionForm({
  action,
  success,
  submitLabel,
  children,
  onDone,
  resetOnSuccess = true,
  className,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  success: string;
  submitLabel: string;
  children: ReactNode;
  onDone?: () => void;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res && res.error) {
            toast.error("Enregistrement refusé", { description: res.error });
            return;
          }
          toast.success(success);
          if (resetOnSuccess) formRef.current?.reset();
          onDone?.();
          router.refresh();
        })
      }
      className={cn("space-y-3", className)}
    >
      {children}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Un bouton qui ouvre une fenêtre contenant un formulaire ; la fenêtre se ferme après succès. */
export function DialogForm({
  trigger,
  title,
  description,
  action,
  success,
  submitLabel,
  children,
  size = "md",
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  action: (fd: FormData) => Promise<ActionResult>;
  success: string;
  submitLabel: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description} size={size}>
        <ActionForm action={action} success={success} submitLabel={submitLabel} onDone={() => setOpen(false)}>
          {children}
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Bouton d'action immédiate (avec confirmation facultative par motif saisi). */
export function ActionButton({
  action,
  success,
  children,
  variant = "secondary",
  askReason,
  confirm,
  disabled,
}: {
  action: (reason: string) => Promise<ActionResult>;
  success: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Libellé du motif à saisir avant d'agir (refus, annulation…). */
  askReason?: string;
  /** Question de confirmation (sans saisie) avant d'agir. */
  confirm?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const go = () =>
    startTransition(async () => {
      const res = await action(reason);
      if (res && res.error) {
        toast.error("Action refusée", { description: res.error });
        return;
      }
      toast.success(success);
      setAsking(false);
      setReason("");
      router.refresh();
    });
  if (confirm && asking) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-xs">
        <span className="text-foreground-muted">{confirm}</span>
        <Button size="sm" variant="danger" loading={pending} onClick={go}>
          Confirmer
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          Retour
        </Button>
      </span>
    );
  }
  if (askReason && asking) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={askReason}
          className="h-9 w-56 rounded-md border border-border bg-surface px-2 text-sm"
        />
        <Button size="sm" variant={variant} loading={pending} disabled={!reason.trim()} onClick={go}>
          Confirmer
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          Retour
        </Button>
      </span>
    );
  }
  return (
    <Button size="sm" variant={variant} loading={pending} disabled={disabled} onClick={() => (askReason || confirm ? setAsking(true) : go())}>
      {children}
    </Button>
  );
}
