"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, X, Plus } from "lucide-react";
import { attachVisuelToLine, detachVisuelFromLine } from "../actions";
import type { AttachableMediaFile } from "./production-order-media-files";

/**
 * Visuel/maquette joint à un article précis (migration 0037, plus à l'ODF
 * entier — section 8 du document de logique) : un ODF mêlant un article à
 * imprimer et un autre non ne peut plus avoir un visuel ambigu "pour tout
 * l'ODF". `required` : vrai si une section de catégorie Impression est
 * retenue sur CET article — la validation de l'ODF sera refusée par
 * validate_production_order() tant qu'aucun visuel n'est joint à cet
 * article précis. Avertissement doux ici, comme pour la fiche Patronnage :
 * le contrôle qui fait autorité reste le RPC.
 */
export function LineVisuelPicker({
  lineId,
  productionOrderId,
  attached,
  available,
  required,
}: {
  lineId: string;
  productionOrderId: string;
  attached: AttachableMediaFile[];
  available: AttachableMediaFile[];
  required: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const attachedIds = new Set(attached.map((f) => f.id));
  const selectable = available.filter((f) => !attachedIds.has(f.id) && f.category === "visuel");
  const missingVisuel = required && attached.length === 0;

  function attach(mediaFileId: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await attachVisuelToLine(lineId, productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function detach(mediaFileId: string) {
    startTransition(async () => {
      const res = await detachVisuelFromLine(lineId, productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Visuel / maquette</p>
        <p className="text-[11px] text-foreground-muted">
          Maquette réalisée par les infographes, jointe à cet article depuis la médiathèque du client.
        </p>
      </div>
      {missingVisuel && (
          <p className="text-xs text-warning">
            ⚠ La validation de l&apos;ODF sera refusée tant qu&apos;aucun visuel n&apos;est joint à cet article.
          </p>
        )}
        <p className="flex items-center gap-1 text-xs font-medium text-foreground-muted">
          <Paperclip className="h-3.5 w-3.5" /> Fichiers liés
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {attached.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground"
            >
              {f.file_name}
              <button
                disabled={pending}
                onClick={() => detach(f.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                aria-label="Détacher"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {attached.length === 0 && <li className="text-xs text-foreground-muted">Aucun visuel joint pour l&apos;instant.</li>}
        </ul>
        {selectable.length > 0 && (
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
