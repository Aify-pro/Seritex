"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleSizeActive } from "../actions";

export function SizeActiveToggle({ sizeId, active }: { sizeId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleSizeActive(sizeId, !active);
          if (res?.error) toast.error(res.error);
        })
      }
      className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        active ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}
