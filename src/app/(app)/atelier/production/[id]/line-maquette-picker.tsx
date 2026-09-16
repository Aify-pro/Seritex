"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ImageOff, X, Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { attachMediaFileToLine, detachMediaFileFromLine } from "../actions";
import type { AttachableMediaFile, MaquetteFile } from "@/lib/types/domain";

export type { MaquetteFile } from "@/lib/types/domain";

/**
 * Maquette (simulation/rendu) jointe à un article précis (migration 0040) —
 * distincte du visuel (fichier d'exploitation, voir LineVisuelPicker) : la
 * maquette se consulte comme une image, ouverte en fenêtre interne pour un
 * aperçu en grand, plutôt qu'affichée seulement par son nom de fichier.
 *
 * Établie normalement dès le devis (migration 0041, validée par le client
 * en l'acceptant) — `fromDevis` s'affiche alors en lecture seule, l'ODF
 * n'a rien à y ajouter ni à en retirer. Seule une ligne dont le devis n'a
 * reçu aucune maquette (`fromDevis` nul) propose ici son propre dépôt
 * (`attached`, éditable) — rattrapage explicitement voulu, jamais un
 * deuxième emplacement concurrent.
 *
 * `editable` : figé dès que l'ODF est validé (migration 0042) — RLS y
 * veille en dernier ressort (production_order_media_files_write/_delete).
 */
export function LineMaquettePicker({
  lineId,
  productionOrderId,
  editable,
  fromDevis,
  attached,
  available,
}: {
  lineId: string;
  productionOrderId: string;
  editable: boolean;
  fromDevis: MaquetteFile | null;
  attached: MaquetteFile[];
  available: AttachableMediaFile[];
}) {
  const [pending, startTransition] = useTransition();
  const attachedIds = new Set(attached.map((f) => f.id));
  const selectable = editable ? available.filter((f) => !attachedIds.has(f.id) && f.category === "maquette") : [];

  function attach(mediaFileId: string) {
    if (!mediaFileId) return;
    startTransition(async () => {
      const res = await attachMediaFileToLine(lineId, productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  function detach(mediaFileId: string) {
    startTransition(async () => {
      const res = await detachMediaFileFromLine(lineId, productionOrderId, mediaFileId);
      if (res?.error) toast.error(res.error);
    });
  }

  if (fromDevis) {
    return (
      <div className="space-y-1.5">
        <div>
          <p className="text-xs font-medium text-foreground-muted">Maquette</p>
          <p className="text-[11px] text-foreground-muted">Validée au devis — cliquez sur la vignette pour l&apos;ouvrir en grand.</p>
        </div>
        <Thumbnail f={fromDevis} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Maquette</p>
        <p className="text-[11px] text-foreground-muted">
          Aucune maquette n&apos;a été déposée au devis pour cet article — à rattraper ici. Cliquez sur une vignette pour
          l&apos;ouvrir en grand. Imprimée telle quelle dans le PDF de l&apos;ODF.
        </p>
      </div>
      {attached.length === 0 ? (
        <p className="text-xs text-foreground-muted">Aucune maquette jointe pour l&apos;instant.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {attached.map((f) => (
            <li key={f.id} className="group relative">
              <Thumbnail f={f} />
              {editable && (
                <button
                  disabled={pending}
                  onClick={() => detach(f.id)}
                  aria-label="Détacher"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-surface p-0.5 text-foreground-muted shadow ring-1 ring-border hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
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
            <option value="">Joindre une maquette de la médiathèque…</option>
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

/** Vignette 80×80 cliquable pour ouvrir l'aperçu en grand dans une fenêtre interne — jamais plus grande que la zone qui lui est réservée. */
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
