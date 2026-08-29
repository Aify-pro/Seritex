"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateRequestStatus } from "../../actions";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/lib/types/domain";

const OPTIONS = Object.entries(REQUEST_STATUS_LABELS) as [RequestStatus, string][];

export function StatusSelect({ requestId, current }: { requestId: string; current: RequestStatus }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={current}
      disabled={pending}
      onChange={(e) =>
        startTransition(async () => {
          const res = await updateRequestStatus(requestId, e.target.value as RequestStatus);
          if (res?.error) toast.error(res.error);
          else toast.success("Statut mis à jour");
        })
      }
      className="h-9 rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-60"
    >
      {OPTIONS.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
