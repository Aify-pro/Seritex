"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LotCodeInput } from "@/components/atelier/lot-code-input";
import { scanArticleLot } from "./actions";

/**
 * Lots QR (SF-5) : à l'arrivée d'un lot dans la section, puis à son départ,
 * on scanne son étiquette. Le parcours du lot (sections traversées) se lit
 * ensuite sur sa fiche et depuis le BL.
 */
export function LotScanPanel({ sectionId }: { sectionId: string }) {
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const scan = (sens: "entree" | "sortie") =>
    startTransition(async () => {
      const res = await scanArticleLot(code, sens, sectionId);
      if (res.error) toast.error("Scan refusé", { description: res.error });
      else {
        toast.success(res.message ?? "Scan enregistré");
        setCode("");
      }
    });
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm font-medium text-foreground sm:w-40">Lot reçu / parti</p>
        <div className="flex-1">
          <LotCodeInput value={code} onChange={setCode} disabled={pending} />
        </div>
        <div className="flex gap-2">
          <Button size="md" variant="secondary" loading={pending} disabled={!code.trim()} onClick={() => scan("entree")}>
            Entrée
          </Button>
          <Button size="md" variant="secondary" loading={pending} disabled={!code.trim()} onClick={() => scan("sortie")}>
            Sortie
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
