"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ImageOff, X, Plus, RefreshCw } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { attachMediaFileToQuoteLine, detachMediaFileFromQuoteLine } from "@/app/(app)/commercial/actions";
import type { AttachableMediaFile, MaquetteFile } from "@/lib/types/domain";

/**
 * Maquette (simulation/rendu) jointe à une ligne de devis (migration 0041) —
 * c'est ici qu'elle est normalement déposée : le client la valide en
 * acceptant le devis, avant même l'échantillon. Une seule par ligne — en
 * choisir une nouvelle remplace silencieusement l'ancienne (voir
 * attachMediaFileToQuoteLine). Si elle reste vide, l'écran ODF correspondant
 * propose son propre rattrapage (voir LineMaquettePicker).
 *
 * `editable` distingue la vue commercial (dépose/remplace) de la vue client
 * (consultation seule, pour valider) — le client doit pouvoir l'ouvrir en
 * grand mais jamais la modifier.
 */
export function QuoteLineMaquettePicker({
  quoteLineId,
  quoteId,
  editable,
  attached,
  available,
}: {
  quoteLineId: string;
  quoteId: string;
  editable: boolean;
  attached: MaquetteFile | null;
  available: AttachableMediaFile[];
}) {
  const [pending, startTransition] = useTransition();
  const selectable = available.filter((f) => f.id !== attached?.id && f.category === "maquette");

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
      <p className="text-xs font-medium text-foreground-muted">Maquette</p>
      {attached ? (
        <div className="flex items-start gap-2">
          <div className="group relative">
            <Thumbnail f={attached} />
            {editable && (
              <button
                disabled={pending}
                onClick={() => detach(attached.id)}
                aria-label="Détacher"
                className="absolute -right-1.5 -top-1.5 rounded-full bg-surface p-0.5 text-foreground-muted shadow ring-1 ring-border hover:bg-danger-soft hover:text-danger disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-foreground-muted">
          {editable ? "Aucune maquette déposée pour l'instant." : "Aucune maquette déposée pour cet article."}
        </p>
      )}
      {editable && selectable.length > 0 && (
        <div className="flex items-center gap-1.5">
          {attached ? (
            <RefreshCw className="h-3.5 w-3.5 text-foreground-muted" />
          ) : (
            <Plus className="h-3.5 w-3.5 text-foreground-muted" />
          )}
          <select
            disabled={pending}
            defaultValue=""
            onChange={(e) => {
              attach(e.target.value);
              e.target.value = "";
            }}
            className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
          >
            <option value="">{attached ? "Remplacer par…" : "Joindre une maquette de la médiathèque…"}</option>
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

function Thumbnail({ f }: { f: MaquetteFile }) {
  if (!f.previewUrl) {
    return (
      <div
        className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface-muted px-1 text-center"
        title={f.file_name}
      >
        <ImageOff className="h-4 w-4 text-foreground-muted" />
        <span className="line-clamp-2 text-[10px] text-foreground-muted">Aperçu indisponible</span>
      </div>
    );
  }
  return (
    <Dialog
      title={f.file_name}
      size="lg"
      trigger={
        <button
          type="button"
          className="block h-20 w-20 overflow-hidden rounded-md border border-border bg-surface-muted"
          title={f.file_name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- image distante (URL signée Supabase Storage), pas un asset optimisable par next/image */}
          <img src={f.previewUrl} alt={f.file_name} className="h-full w-full object-cover" />
        </button>
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- idem, aperçu en grand dans la fenêtre interne */}
      <img src={f.previewUrl} alt={f.file_name} className="max-h-[65vh] w-full object-contain" />
      <p className="mt-2 text-center text-xs text-foreground-muted">{f.file_name}</p>
    </Dialog>
  );
}
