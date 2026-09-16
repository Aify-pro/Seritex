"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, X, Plus, Download } from "lucide-react";
import { attachMediaFileToQuoteLine, detachMediaFileFromQuoteLine } from "@/app/(app)/commercial/actions";
import type { AttachableMediaFile, DownloadableMediaFile } from "@/lib/types/domain";

/**
 * Visuel(s) joints à une ligne de devis (migration 0041) — le ou les
 * fichiers d'exploitation que la section Impression utilisera, déposables
 * dès cette étape (contrairement à la maquette, qui a un point d'entrée
 * unique). Un visuel déposé ici reste visible (et téléchargeable) sur la
 * ligne d'ODF correspondante, en plus de ceux ajoutés directement là-bas.
 *
 * `editable` distingue la vue commercial (dépose/retire) de la vue client
 * (consultation, téléchargement).
 */
export function QuoteLineVisuelPicker({
  quoteLineId,
  quoteId,
  editable,
  attached,
  available,
}: {
  quoteLineId: string;
  quoteId: string;
  editable: boolean;
  attached: DownloadableMediaFile[];
  available: AttachableMediaFile[];
}) {
  const [pending, startTransition] = useTransition();
  const attachedIds = new Set(attached.map((f) => f.id));
  const selectable = available.filter((f) => !attachedIds.has(f.id) && f.category === "visuel");

  function attach(mediaFileId: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await attachMediaFileToQuoteLine(quoteLineId, quoteId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function detach(mediaFileId: string) {
    startTransition(async () => {
      const res = await detachMediaFileFromQuoteLine(quoteLineId, quoteId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1 text-xs font-medium text-foreground-muted">
        <Paperclip className="h-3.5 w-3.5" /> Visuel(s)
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {attached.map((f) => (
          <li key={f.id} className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground">
            {f.downloadUrl ? (
              <a href={f.downloadUrl} download={f.file_name} className="flex items-center gap-1 hover:underline" title="Télécharger">
                <Download className="h-3 w-3 text-foreground-muted" />
                {f.file_name}
              </a>
            ) : (
              f.file_name
            )}
            {editable && (
              <button
                disabled={pending}
                onClick={() => detach(f.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                aria-label="Détacher"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
        {attached.length === 0 && <li className="text-xs text-foreground-muted">Aucun visuel joint pour l&apos;instant.</li>}
      </ul>
      {editable && selectable.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5 text-foreground-muted" />
          <select
            disabled={pending}
            defaultValue=""
            onChange={(e) => {
              attach(e.target.value);
              e.target.value = "";
            }}
            className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
          >
            <option value="">Joindre un visuel de la médiathèque…</option>
            {selectable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.file_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
