"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { simulateStockSync } from "../actions";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await simulateStockSync();
          toast.success("Synchronisation simulée");
          router.refresh();
        })
      }
    >
      <RefreshCw className="h-3.5 w-3.5" /> Simuler une synchronisation
    </Button>
  );
}
