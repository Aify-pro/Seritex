"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, ImageOff, Info, X } from "lucide-react";
import { attachMediaFileToSampleArticle, detachMediaFileFromSampleArticle } from "@/lib/actions/samples";
import { MediaPickerDialog } from "@/components/media/media-picker-dialog";
import { Dialog } from "@/components/ui/dialog";
import type { MaquetteFile } from "@/lib/types/domain";
import type { SampleArticleMedia } from "@/lib/samples";

/**
 * Maquette et visuel(s) de l'article, déposables depuis la fiche
 * échantillon (0094). Les fichiers ne sont pas stockés sur la fiche : ils
 * vont sur la ligne d'article (devis, ou article d'ODF si la fiche y est
 * rattachée en direct), donc l'écran ODF les affiche automatiquement et
 * l'Infographie peut affecter chaque visuel à son atelier — quelle que
 * soit la technique d'impression.
 */
export function SampleArticleMediaFiles({
  sampleId,
  companyId,
  requestId,
  media,
  editable,
}: {
  sampleId: string;
  companyId: string | null;
  requestId: string | null;
  media: SampleArticleMedia;
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function attach(mediaFileId: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await attachMediaFileToSampleArticle(sampleId, mediaFileId);
      if (res?.error) toast.error(res.error);
      else toast.success("Fichier joint à l'article");
    });
  }

  function detach(mediaFileId: string) {
    startTransition(async () => {
      const res = await detachMediaFileFromSampleArticle(sampleId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  const attachedIds = new Set([
    ...(media.maquette ? [media.maquette.id] : []),
    ...media.visuels.map((f) => f.id),
  ]);
  const selectableMaquettes = media.available.filter((f) => f.category === "maquette" && !attachedIds.has(f.id));
  const selectableVisuels = media.available.filter((f) => f.category === "visuel" && !attachedIds.has(f.id));

  if (media.target === null) {
    return (
      <div className="rounded-md border border-border bg-surface-muted/40 p-3">
        <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <Info className="h-3.5 w-3.5" />
          Maquette et visuels se déposent sur la ligne d&apos;article : rattachez d&apos;abord cette fiche à une ligne de devis.
        </p>
      </div>
    );
  }

  const canEdit = editable && !media.locked;
  const targetLabel = media.target === "quote_line" ? "la ligne de devis" : "l'article d'ODF";

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-xs font-semibold text-foreground">Maquette et visuels de l&apos;article</p>
        <p className="text-[11px] text-foreground-muted">
          Déposés sur {targetLabel} — ils apparaissent automatiquement sur l&apos;article de l&apos;ODF, quelle que soit la
          technique d&apos;impression.
        </p>
      </div>

      {media.locked && (
        <p className="flex items-start gap-1.5 text-xs text-foreground-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          L&apos;ordre de fabrication est lancé : maquette et visuels sont figés.
        </p>
      )}

      {media.requiresVisuel && media.visuels.length === 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Cet article passe par un atelier qui exige un visuel, et aucun fichier n&apos;est joint. À déposer pour que
          l&apos;impression puisse travailler.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground-muted">Maquette</p>
          {media.maquette ? (
            <div className="flex items-start gap-2">
              <div className="group relative">
                <Thumbnail f={media.maquette} />
                {canEdit && (
                  <button
                    disabled={pending}
                    onClick={() => detach(media.maquette!.id)}
                    aria-label="Détacher la maquette"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-surface p-0.5 text-foreground-muted shadow ring-1 ring-border hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="max-w-[9rem] break-words text-[11px] text-foreground-muted">{media.maquette.file_name}</p>
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">Aucune maquette pour cet article.</p>
          )}
          {canEdit && (
            <MediaPickerDialog
              triggerLabel={media.maquette ? "Remplacer la maquette" : "Ajouter une maquette"}
              dialogTitle="Joindre une maquette à l'article"
              companyId={companyId ?? ""}
              requestId={requestId}
              category="maquette"
              files={selectableMaquettes}
              onPick={attach}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground-muted">Visuel(s)</p>
          <ul className="flex flex-wrap gap-1.5">
            {media.visuels.map((f) => (
              <li key={f.id} className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground">
                {f.downloadUrl ? (
                  <a href={f.downloadUrl} download={f.file_name} className="flex items-center gap-1 hover:underline" title="Télécharger">
                    <Download className="h-3 w-3 text-foreground-muted" />
                    {f.file_name}
                  </a>
                ) : (
                  f.file_name
                )}
                {canEdit && (
                  <button
                    disabled={pending}
                    onClick={() => detach(f.id)}
                    aria-label="Détacher"
                    className="ml-1 rounded-full p-0.5 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
            {media.visuels.length === 0 && <li className="text-xs text-foreground-muted">Aucun visuel joint.</li>}
          </ul>
          {canEdit && (
            <MediaPickerDialog
              triggerLabel="Ajouter un visuel"
              dialogTitle="Joindre un visuel à l'article"
              companyId={companyId ?? ""}
              requestId={requestId}
              category="visuel"
              files={selectableVisuels}
              onPick={attach}
            />
          )}
        </div>
      </div>

      {media.odfOnly.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="text-[11px] font-medium text-foreground-muted">Déposés directement sur l&apos;ODF (retirables là-bas)</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {media.odfOnly.map((f) => (
              <li key={f.id} className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] text-foreground-muted">
                {f.file_name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Même vignette que la maquette du devis (quote-line-maquette-picker). */
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
        <button type="button" className="block h-20 w-20 overflow-hidden rounded-md border border-border bg-surface-muted" title={f.file_name}>
          {/* eslint-disable-next-line @next/next/no-img-element -- image distante (URL signée), pas un asset optimisable par next/image */}
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
