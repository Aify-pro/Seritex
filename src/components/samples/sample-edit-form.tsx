"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateSampleRequest } from "@/lib/actions/samples";
import { SAMPLE_PRIORITY_LABELS, type SamplePriority } from "@/lib/types/domain";

const PRIORITIES: SamplePriority[] = ["basse", "normale", "haute", "urgente"];

/**
 * Édition complète de la fiche (besoin, quantité, priorité, dates, infos
 * complémentaires) — ouverte depuis la fenêtre de prévisualisation, réservée
 * au staff qui en a le droit (le bouton qui ouvre ce formulaire n'est rendu
 * que pour ces rôles, cf. `sample-detail-content.tsx`).
 */
export function SampleEditForm({
  sampleId,
  needDescription,
  quantityRequested,
  priority,
  requestDate,
  dueDate,
  extraInfo,
  onSaved,
}: {
  sampleId: string;
  needDescription: string;
  quantityRequested: number;
  priority: SamplePriority;
  requestDate: string;
  dueDate: string | null;
  extraInfo: string | null;
  onSaved?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      const res = await updateSampleRequest(sampleId, formData);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("Fiche mise à jour");
        onSaved?.();
      }
    });
  }

  return (
    <form action={save} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Besoin exprimé</label>
        <textarea
          name="need_description"
          required
          rows={3}
          defaultValue={needDescription}
          className="w-full rounded-md border border-border bg-surface p-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Informations complémentaires</label>
        <textarea
          name="extra_info"
          rows={2}
          defaultValue={extraInfo ?? ""}
          className="w-full rounded-md border border-border bg-surface p-2 text-sm"
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Quantité</label>
          <input
            name="quantity_requested"
            type="number"
            min={1}
            defaultValue={quantityRequested}
            className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Date de la demande</label>
          <input
            name="request_date"
            type="date"
            defaultValue={requestDate}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Priorité</label>
          <select name="priority" defaultValue={priority} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {SAMPLE_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Délai souhaité</label>
          <input name="due_date" type="date" defaultValue={dueDate ?? ""} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
