"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { launchProductionOrder } from "../actions";
import { toast } from "sonner";
import { Rocket } from "lucide-react";

export function LaunchButton({ productionOrderId }: { productionOrderId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await launchProductionOrder(productionOrderId);
          if (res.error) toast.error("Impossible de lancer l'ordre de fabrication", { description: res.error });
          else toast.success("Ordres de travail générés — la production démarre.");
        })
      }
    >
      <Rocket className="h-4 w-4" />
      Lancer la fabrication
    </Button>
  );
}
