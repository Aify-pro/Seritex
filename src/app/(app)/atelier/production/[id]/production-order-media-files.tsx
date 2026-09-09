"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Paperclip, X, Plus } from "lucide-react";
import { attachMediaFileToProductionOrder, detachMediaFileFromProductionOrder } from "../actions";
import { MEDIA_CATEGORY_LABELS, type MediaFileCategory } from "@/lib/types/domain";

export interface AttachableMediaFile {
  id: string;
  file_name: string;
  category: MediaFileCategory;
}

/**
 * Visuel/maquette joint à l'ODF (section 8) : réutilise MEDIA_FILE, comme
 * les fichiers liés à une fiche échantillon — aucun nouveau système de
 * stockage. Le dépôt du fichier lui-même se fait depuis la médiathèque du
 * client, ici on ne fait que le rattacher/détacher.
 */
export function ProductionOrderMediaFiles({
  productionOrderId,
  attached,
  available,
}: {
  productionOrderId: string;
  attached: AttachableMediaFile[];
  available: AttachableMediaFile[];
}) {
  const [pending, startTransition] = useTransition();
  const attachedIds = new Set(attached.map((f) => f.id));
  const selectable = available.filter((f) => !attachedIds.has(f.id));

  function attach(mediaFileId: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await attachMediaFileToProductionOrder(productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function detach(mediaFileId: string) {
    startTransition(async () => {
      const res = await detachMediaFileFromProductionOrder(productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Visuel / maquette"
        description="Maquette réalisée par les infographes, jointe à l'ODF depuis la médiathèque du client (section 8)."
      />
      <CardBody className="space-y-1.5">
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
              <span className="text-foreground-muted">· {MEDIA_CATEGORY_LABELS[f.category]}</span>
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
              <option value="">Joindre un fichier de la médiathèque…</option>
              {selectable.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.file_name} ({MEDIA_CATEGORY_LABELS[f.category]})
                </option>
              ))}
            </select>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
