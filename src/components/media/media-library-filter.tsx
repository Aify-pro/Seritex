"use client";

import { useRouter, usePathname } from "next/navigation";
import type { RequestOption } from "@/components/media/media-file-requests";

/** Filtre "dossier" de la médiathèque par demande (migration 0043) — navigue vers `?requestId=...`, "Toutes les demandes" retire le filtre. */
export function MediaLibraryFilter({
  requests,
  currentRequestId,
}: {
  requests: RequestOption[];
  currentRequestId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="mediatheque-demande" className="text-xs font-medium text-foreground-muted">
        Dossier
      </label>
      <select
        id="mediatheque-demande"
        defaultValue={currentRequestId ?? ""}
        onChange={(e) => router.push(e.target.value ? `${pathname}?requestId=${e.target.value}` : pathname)}
        className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
      >
        <option value="">Toutes les demandes</option>
        {requests.map((r) => (
          <option key={r.id} value={r.id}>
            {r.reference}
          </option>
        ))}
      </select>
    </div>
  );
}
