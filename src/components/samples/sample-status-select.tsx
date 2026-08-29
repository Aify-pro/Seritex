"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateSampleStatus } from "@/lib/actions/samples";
import { SAMPLE_STATUS_LABELS, type SampleRequestStatus } from "@/lib/types/domain";

const EDITABLE: SampleRequestStatus[] = ["demande", "en_fabrication", "envoye", "recu_client"];

export function SampleStatusSelect({ sampleId, current }: { sampleId: string; current: SampleRequestStatus }) {
  const [pending, startTransition] = useTransition();

  if (!EDITABLE.includes(current)) {
    return <span className="text-xs text-foreground-muted">{SAMPLE_STATUS_LABELS[current]}</span>;
  }

  return (
    <select
      defaultValue={current}
      disabled={pending}
      onChange={(e) =>
        startTransition(async () => {
          const res = await updateSampleStatus(sampleId, e.target.value as SampleRequestStatus);
          if (res?.error) toast.error(res.error);
          else toast.success("Statut mis à jour");
        })
      }
      className="h-8 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
    >
      {EDITABLE.map((s) => (
        <option key={s} value={s}>
          {SAMPLE_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
