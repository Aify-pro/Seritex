"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, X, Download } from "lucide-react";
import {
  assignVisuelToSection,
  attachMediaFileToLine,
  detachMediaFileFromLine,
  unassignVisuelFromSection,
} from "../actions";
import { MediaPickerDialog } from "@/components/media/media-picker-dialog";
import type { AttachableMediaFile, DownloadableMediaFile } from "@/lib/types/domain";

/**
 * Visuel joint à un article précis (migration 0037, plus à l'ODF entier —
 * section 8 du document de logique) : le ou les fichiers d'exploitation à
 * utiliser tels quels à l'impression — distincts de la maquette
 * (simulation/rendu, migration 0040, voir LineMaquettePicker). Cliquer sur
 * un visuel le télécharge (c'est un fichier de travail, pas une image à
 * prévisualiser).
 *
 * Peuvent être déposés à n'importe quelle phase, du devis à l'ODF (migration
 * 0041) : `fromDevis` (lecture seule ici — seul l'écran du devis les
 * détache) et `attached` (déposés directement sur cet article d'ODF,
 * détachables ici) s'affichent tous les deux, sans distinction visuelle
 * autre que la présence du bouton de détachement.
 *
 * `required` : vrai si une section de catégorie Impression est retenue sur
 * CET article — la validation de l'ODF sera refusée par
 * validate_production_order() tant qu'aucun visuel (devis ou ODF) n'est
 * joint. Avertissement doux ici, comme pour la fiche Patronnage : le
 * contrôle qui fait autorité reste le RPC.
 *
 * `editable` : figé dès que l'ODF est validé (migration 0042) — au-delà,
 * plus de détachement ni de nouveau dépôt, RLS y veille en dernier ressort
 * (production_order_media_files_write/_delete). Les visuels du devis
 * restent de toute façon en lecture seule ici, quel que soit ce statut.
 *
 * Quand plusieurs ateliers d'impression sont retenus sur l'article (DTF et
 * sérigraphie par exemple), chacun a sa propre zone : on y affecte le visuel
 * qui part dans CET atelier (migration 0069). Les fichiers restent joints à
 * l'article ; l'affectation dit seulement où ils partent. Avec un seul
 * atelier d'impression, rien ne change : tous les visuels vont à cet atelier.
 */
export function LineVisuelPicker({
  lineId,
  productionOrderId,
  companyId,
  requestId,
  editable,
  fromDevis,
  attached,
  available,
  required,
  impressionSections,
  affectations,
}: {
  lineId: string;
  productionOrderId: string;
  companyId: string;
  /** Demande d'origine de cet ODF (ODF → devis → demande) — les fichiers proposés dans la fenêtre "Ajouter" y sont déjà affiliés (migration 0043). */
  requestId: string | null;
  editable: boolean;
  fromDevis: DownloadableMediaFile[];
  attached: DownloadableMediaFile[];
  available: AttachableMediaFile[];
  required: boolean;
  /** Ateliers retenus sur cet article dont la catégorie exige un visuel, dans leur ordre de passage. */
  impressionSections: { id: string; name: string }[];
  affectations: { sectionId: string; mediaFileId: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const attachedIds = new Set([...fromDevis, ...attached].map((f) => f.id));
  const selectable = editable ? available.filter((f) => !attachedIds.has(f.id) && f.category === "visuel") : [];
  const missingVisuel = required && fromDevis.length === 0 && attached.length === 0;

  const parAtelier = impressionSections.length > 1;
  const lineVisuels = [...fromDevis, ...attached];

  function attach(mediaFileId: string, sectionId?: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await attachMediaFileToLine(lineId, productionOrderId, mediaFileId, sectionId);
      if (res?.error) toast.error(res.error);
    });
  }

  function assign(sectionId: string, mediaFileId: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await assignVisuelToSection(lineId, productionOrderId, sectionId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function unassign(sectionId: string, mediaFileId: string) {
    startTransition(async () => {
      const res = await unassignVisuelFromSection(lineId, productionOrderId, sectionId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function detach(mediaFileId: string) {
    startTransition(async () => {
      const res = await detachMediaFileFromLine(lineId, productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function Chip({
    f,
    detachable,
    onRemove,
    removeLabel = "Détacher",
  }: {
    f: DownloadableMediaFile;
    detachable: boolean;
    onRemove?: () => void;
    removeLabel?: string;
  }) {
    return (
      <li className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground">
        {f.downloadUrl ? (
          <a
            href={f.downloadUrl}
            download={f.file_name}
            className="flex items-center gap-1 hover:underline"
            title="Télécharger"
          >
            <Download className="h-3 w-3 text-foreground-muted" />
            {f.file_name}
          </a>
        ) : (
          f.file_name
        )}
        {detachable && (
          <button
            disabled={pending}
            onClick={onRemove ?? (() => detach(f.id))}
            className="ml-1 rounded-full p-0.5 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
            aria-label={removeLabel}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Visuel(s)</p>
        <p className="text-[11px] text-foreground-muted">
          Fichier(s) d&apos;exploitation à utiliser tels quels à l&apos;impression — cliquez pour télécharger.
        </p>
      </div>
      {missingVisuel && (
          <p className="text-xs text-warning">
            ⚠ La validation de l&apos;ODF sera refusée tant qu&apos;aucun visuel n&apos;est joint à cet article.
          </p>
        )}
      {parAtelier && (
        <div className="grid gap-2 sm:grid-cols-2">
          {impressionSections.map((section) => {
            const assignedIds = new Set(
              affectations.filter((a) => a.sectionId === section.id).map((a) => a.mediaFileId)
            );
            const assigned = lineVisuels.filter((f) => assignedIds.has(f.id));
            const assignable = lineVisuels.filter((f) => !assignedIds.has(f.id));
            const selectableHere = editable
              ? available.filter((f) => !assignedIds.has(f.id) && f.category === "visuel")
              : [];
            return (
              <div key={section.id} className="space-y-1.5 rounded-md border border-border bg-surface p-2.5">
                <p className="text-xs font-semibold text-foreground">{section.name}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {assigned.map((f) => (
                    <Chip
                      key={f.id}
                      f={f}
                      detachable={editable}
                      onRemove={() => unassign(section.id, f.id)}
                      removeLabel={`Retirer de ${section.name}`}
                    />
                  ))}
                  {assigned.length === 0 && (
                    <li className="text-xs text-warning">Aucun visuel pour cet atelier.</li>
                  )}
                </ul>
                {editable && assignable.length > 0 && (
                  <select
                    value=""
                    disabled={pending}
                    onChange={(e) => assign(section.id, e.target.value)}
                    className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                  >
                    <option value="">+ Affecter un visuel de l&apos;article…</option>
                    {assignable.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.file_name}
                      </option>
                    ))}
                  </select>
                )}
                {editable && (
                  <MediaPickerDialog
                    triggerLabel={`Ajouter un visuel — ${section.name}`}
                    dialogTitle={`Joindre un visuel — ${section.name}`}
                    companyId={companyId}
                    requestId={requestId}
                    category="visuel"
                    files={selectableHere}
                    onPick={(mediaFileId) => attach(mediaFileId, section.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {parAtelier && (() => {
        const affectes = new Set(affectations.map((a) => a.mediaFileId));
        const nonAffectes = lineVisuels.filter((f) => !affectes.has(f.id));
        if (nonAffectes.length === 0) return null;
        return (
          <div className="space-y-1">
            <p className="text-xs text-foreground-muted">Visuels de l&apos;article pas encore affectés à un atelier :</p>
            <ul className="flex flex-wrap gap-1.5">
              {nonAffectes.map((f) => (
                <Chip key={f.id} f={f} detachable={editable && !fromDevis.some((d) => d.id === f.id)} />
              ))}
            </ul>
          </div>
        );
      })()}
      {!parAtelier && (
        <>
        <p className="flex items-center gap-1 text-xs font-medium text-foreground-muted">
          <Paperclip className="h-3.5 w-3.5" /> Fichiers liés
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {fromDevis.map((f) => (
            <Chip key={f.id} f={f} detachable={false} />
          ))}
          {attached.map((f) => (
            <Chip key={f.id} f={f} detachable={editable} />
          ))}
          {fromDevis.length === 0 && attached.length === 0 && (
            <li className="text-xs text-foreground-muted">Aucun visuel joint pour l&apos;instant.</li>
          )}
        </ul>
        {editable && (
          <MediaPickerDialog
            triggerLabel="Ajouter un visuel"
            dialogTitle="Joindre un visuel"
            companyId={companyId}
            requestId={requestId}
            category="visuel"
            files={selectable}
            onPick={(mediaFileId) => attach(mediaFileId)}
          />
        )}
        </>
      )}
    </div>
  );
}
