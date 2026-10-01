"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleStorageTargetActive } from "@/lib/actions/media";

export function TargetActiveToggle({ targetId, active }: { targetId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? "Désactiver cette cible" : "Activer cette cible"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleStorageTargetActive(targetId, !active);
          if (res?.error) toast.error(res.error);
          else toast.success(active ? "Cible désactivée" : "Cible activée");
        })
      }
      className="flex items-center gap-2 disabled:opacity-50"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${active ? "bg-success" : "bg-border"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
      <span className={`w-12 text-left text-xs font-medium ${active ? "text-success" : "text-foreground-muted"}`}>
        {active ? "Active" : "Inactive"}
      </span>
    </button>
  );
}
