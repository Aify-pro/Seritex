"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateSampleDetails } from "@/lib/actions/samples";
import { SAMPLE_PRIORITY_LABELS, type SamplePriority } from "@/lib/types/domain";

const PRIORITIES: SamplePriority[] = ["basse", "normale", "haute", "urgente"];

/** Édition rapide de la priorité et du délai — réservée au staff commercial/production (section 2.1). */
export function SampleDetailsForm({
  sampleId,
  priority,
  dueDate,
  extraInfo,
}: {
  sampleId: string;
  priority: SamplePriority;
  dueDate: string | null;
  extraInfo: string | null;
}) {
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      const res = await updateSampleDetails(sampleId, formData);
      if (res?.error) toast.error(res.error);
      else toast.success("Fiche mise à jour");
    });
  }

  return (
    <form action={save} className="flex flex-wrap items-center gap-2 text-xs">
      <select
        name="priority"
        defaultValue={priority}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {SAMPLE_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      <input
        name="due_date"
        type="date"
        defaultValue={dueDate ?? ""}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
      />
      {/* Préserve les infos complémentaires existantes : ce formulaire compact ne les édite pas. */}
      <input type="hidden" name="extra_info" value={extraInfo ?? ""} />
    </form>
  );
}
