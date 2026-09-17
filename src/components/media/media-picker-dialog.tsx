"use client";

import { useState } from "react";
import { Plus, FileText } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadMediaForm } from "@/components/media/upload-media-form";
import type { AttachableMediaFile, MediaFileCategory } from "@/lib/types/domain";

/**
 * Fenêtre interne ouverte par le bouton "Ajouter" des pickers visuel/
 * maquette (ODF et devis, migration 0043) : choisir un fichier déjà
 * affilié à la demande de cet article, ou en déposer un nouveau — mais
 * toujours via la médiathèque elle-même (`UploadMediaForm`, catégorie et
 * demande pré-remplies), jamais un mécanisme de dépôt séparé.
 *
 * `files` n'est PAS toute la médiathèque du client : c'est déjà, côté
 * serveur, le sous-ensemble affilié à la demande de l'article appelant —
 * un fichier affilié seulement à une autre demande n'y apparaît pas tant
 * qu'il n'a pas été explicitement rattaché à celle-ci (depuis la
 * médiathèque, voir MediaFileRequests).
 */
export function MediaPickerDialog({
  triggerLabel,
  dialogTitle,
  companyId,
  requestId,
  category,
  files,
  onPick,
}: {
  triggerLabel: string;
  dialogTitle: string;
  companyId: string;
  requestId: string | null;
  category: MediaFileCategory;
  files: AttachableMediaFile[];
  onPick: (mediaFileId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(mediaFileId: string) {
    onPick(mediaFileId);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={dialogTitle}
      trigger={
        <Button type="button" size="sm" variant="secondary">
          <Plus className="h-3.5 w-3.5" /> {triggerLabel}
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium text-foreground-muted">Fichiers déjà affiliés à cette demande</p>
          {files.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
              Aucun fichier de cette catégorie affilié à cette demande pour l&apos;instant.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => pick(f.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand-soft/40"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-foreground-muted" />
                    {f.file_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {requestId ? (
          <UploadMediaForm companyId={companyId} requestId={requestId} presetCategory={category} onUploaded={pick} />
        ) : (
          <p className="text-xs text-warning">
            ⚠ Aucune demande retrouvée pour cet article — le dépôt direct est indisponible ici, passez par la médiathèque.
          </p>
        )}
      </div>
    </Dialog>
  );
}
