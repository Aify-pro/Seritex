"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadMediaFile } from "@/lib/actions/media";
import type { MediaFileCategory } from "@/lib/types/domain";

/**
 * Dépôt direct d'un nouveau fichier, sans passer par la médiathèque du
 * client au préalable — les pickers visuel/maquette (ODF et devis) ne
 * proposaient jusqu'ici qu'un choix parmi les fichiers déjà présents dans
 * la médiathèque : si la catégorie visée (ex. "maquette") n'en comptait
 * encore aucun, rien n'apparaissait, comme s'il n'existait aucun moyen d'en
 * ajouter un. `uploadMediaFile` dépose et réplique le fichier comme depuis
 * la médiathèque elle-même (même RPC, même raison obligatoire pour la
 * traçabilité) ; `onUploaded` reçoit l'identifiant obtenu pour l'attacher
 * immédiatement à l'article/la ligne appelante.
 */
export function InlineMediaUpload({
  companyId,
  category,
  onUploaded,
  label = "Déposer",
}: {
  companyId: string;
  category: MediaFileCategory;
  onUploaded: (mediaFileId: string) => void;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          formData.set("company_id", companyId);
          formData.set("category", category);
          const res = await uploadMediaFile(formData);
          if (res?.error) {
            toast.error("Dépôt impossible", { description: res.error });
            return;
          }
          if (res.mediaFileId) onUploaded(res.mediaFileId);
          formRef.current?.reset();
        })
      }
      className="flex flex-wrap items-center gap-1.5"
    >
      <input
        name="file"
        type="file"
        required
        disabled={pending}
        className="block max-w-[10rem] text-[11px] file:mr-1.5 file:h-6 file:rounded-md file:border-0 file:bg-surface-muted file:px-2 file:text-[11px] file:font-medium file:text-foreground disabled:opacity-60"
      />
      <input
        name="reason"
        type="text"
        required
        minLength={4}
        disabled={pending}
        placeholder="Motif du dépôt"
        className="h-7 w-32 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
      />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        <UploadCloud className="h-3.5 w-3.5" /> {label}
      </Button>
    </form>
  );
}
