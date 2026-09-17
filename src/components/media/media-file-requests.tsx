"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Folder, X, Plus } from "lucide-react";
import { attachMediaFileToRequest, detachMediaFileFromRequest } from "@/lib/actions/requests";

export interface RequestOption {
  id: string;
  reference: string;
}

/**
 * Demandes auxquelles un fichier de la médiathèque est affilié (migration
 * 0043) — un fichier peut appartenir à plusieurs "dossiers" à la fois, pour
 * être réutilisé d'une demande à l'autre sans le redéposer. Même patron que
 * SampleMediaFiles (chips détachables + `<select>` d'ajout), appliqué ici
 * dans l'autre sens : une demande par chip plutôt qu'un fichier par chip.
 */
export function MediaFileRequests({
  mediaFileId,
  attached,
  available,
}: {
  mediaFileId: string;
  attached: RequestOption[];
  available: RequestOption[];
}) {
  const [pending, startTransition] = useTransition();
  const attachedIds = new Set(attached.map((r) => r.id));
  const selectable = available.filter((r) => !attachedIds.has(r.id));

  function attach(requestId: string) {
    if (!requestId) return;
    startTransition(async () => {
      const res = await attachMediaFileToRequest(requestId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function detach(requestId: string) {
    startTransition(async () => {
      const res = await detachMediaFileFromRequest(requestId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Folder className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
      {attached.map((r) => (
        <span
          key={r.id}
          className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-foreground-muted"
        >
          {r.reference}
          <button
            disabled={pending}
            onClick={() => detach(r.id)}
            aria-label="Retirer du dossier"
            className="rounded-full p-0.5 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {attached.length === 0 && <span className="text-[11px] text-foreground-muted">Non affilié à une demande</span>}
      {selectable.length > 0 && (
        <div className="flex items-center gap-1">
          <Plus className="h-3 w-3 text-foreground-muted" />
          <select
            disabled={pending}
            defaultValue=""
            onChange={(e) => {
              attach(e.target.value);
              e.target.value = "";
            }}
            className="h-6 rounded-full border border-dashed border-border bg-surface px-2 text-[11px] text-foreground-muted disabled:opacity-60"
          >
            <option value="">Affilier à…</option>
            {selectable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.reference}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
