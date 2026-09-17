"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleNotificationEvent } from "./actions";

export function EventEnabledToggle({ eventId, enabled }: { eventId: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleNotificationEvent(eventId, !enabled);
          if (res?.error) toast.error(res.error);
        })
      }
      className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        enabled ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
      }`}
    >
      {enabled ? "Activé" : "Désactivé"}
    </button>
  );
}
