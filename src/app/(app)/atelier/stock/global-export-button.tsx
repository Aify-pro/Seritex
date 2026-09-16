"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateGlobalStockExportFiche } from "./actions";

export function GlobalExportButton({ unexportedCount }: { unexportedCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const res = await generateGlobalStockExportFiche();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Fiche ${res.numero} générée`);
      router.refresh();
    });
  }

  return (
    <Button size="sm" onClick={generate} loading={pending} disabled={unexportedCount === 0}>
      Exporter tous les mouvements en attente ({unexportedCount})
    </Button>
  );
}
