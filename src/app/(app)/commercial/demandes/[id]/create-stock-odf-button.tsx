"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStockProductionOrder } from "./stock-actions";

/** Crée l'ODF de stock (brouillon) depuis une demande pour le stock. */
export function CreateStockOdfButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createStockProductionOrder(requestId);
          if (res.error) toast.error("ODF non créé", { description: res.error });
          else {
            toast.success("ODF de stock créé en brouillon");
            router.push(`/atelier/production/${res.id}`);
          }
        })
      }
    >
      Créer l&apos;ODF de stock
    </Button>
  );
}
