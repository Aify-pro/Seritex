"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadMediaFile } from "@/lib/actions/media";
import { MEDIA_CATEGORY_LABELS, type MediaFileCategory } from "@/lib/types/domain";
import { UploadCloud } from "lucide-react";

const CATEGORIES: MediaFileCategory[] = ["visuel", "image_de_marque", "fiche_technique", "nuancier", "maquette", "autre"];

/**
 * Dépôt d'un nouveau fichier dans la médiathèque du client — la raison est
 * obligatoire (section 3.7 de l'analyse) : aucun dépôt ne peut être
 * enregistré sans elle, contrainte également appliquée en base.
 *
 * Réutilisé tel quel dans la fenêtre de sélection visuel/maquette (voir
 * MediaPickerDialog, migration 0043) : `presetCategory` verrouille alors la
 * catégorie (plus de sélecteur, la fenêtre sait déjà ce qu'elle demande),
 * `requestId` affilie le dépôt à la demande courante dès la création, et
 * `onUploaded` laisse l'appelant enchaîner (ici : sélectionner
 * immédiatement le fichier déposé) — un dépôt reste toujours un dépôt de
 * médiathèque, jamais un mécanisme séparé propre à cette fenêtre.
 */
export function UploadMediaForm({
  companyId,
  requestId,
  presetCategory,
  onUploaded,
}: {
  companyId: string;
  requestId?: string;
  presetCategory?: MediaFileCategory;
  onUploaded?: (mediaFileId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await uploadMediaFile(formData);
          if (res?.error) {
            toast.error(res.error);
            return;
          }
          toast.success("Fichier ajouté à la médiathèque");
          formRef.current?.reset();
          if (res.mediaFileId) onUploaded?.(res.mediaFileId);
        })
      }
      className="space-y-3 rounded-md border border-dashed border-border p-4"
    >
      <input type="hidden" name="company_id" value={companyId} />
      {requestId && <input type="hidden" name="request_id" value={requestId} />}
      {presetCategory && <input type="hidden" name="category" value={presetCategory} />}
      <p className="text-sm font-medium text-foreground">Ajouter un fichier</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Fichier</label>
          <input
            name="file"
            type="file"
            required
            className="block text-sm file:mr-2 file:h-8 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:text-xs file:font-medium file:text-foreground"
          />
        </div>
        {!presetCategory && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Catégorie</label>
            <select name="category" defaultValue="autre" className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MEDIA_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">
          Raison du dépôt <span className="text-danger">*</span>
        </label>
        <input
          name="reason"
          required
          minLength={4}
          placeholder="Ex : nouvelle charte graphique transmise par le client"
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        <UploadCloud className="h-3.5 w-3.5" /> Déposer
      </Button>
    </form>
  );
}
