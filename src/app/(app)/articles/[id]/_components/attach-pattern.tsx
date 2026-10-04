"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { attachPatternArticle } from "../../actions";

/** Rattacher à ce modèle un article de patronnage encore orphelin. */
export function AttachPattern({
  productModelId,
  orphans,
}: {
  productModelId: string;
  orphans: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (orphans.length === 0) return null;
  return (
    <select
      value=""
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        if (!id) return;
        startTransition(async () => {
          const res = await attachPatternArticle(id, productModelId);
          if (res.error) toast.error("Rattachement refusé", { description: res.error });
          else {
            toast.success("Patron rattaché à ce modèle");
            router.refresh();
          }
        });
      }}
      className="w-full rounded-md border border-border bg-surface p-2 text-xs disabled:opacity-60"
    >
      <option value="">+ Rattacher un patron sans modèle ({orphans.length})…</option>
      {orphans.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
