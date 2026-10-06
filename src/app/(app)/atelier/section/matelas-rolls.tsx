"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LotCodeInput } from "@/components/atelier/lot-code-input";
import { attachRollToMatelas } from "./actions";

export interface MatelasRoll {
  code: string;
  laizeCm: number | null;
  bain: string | null;
  poidsKg: number;
}

/**
 * Rouleaux utilisés pour un matelas (migration 0095) : scannés à la coupe.
 * Le rouleau porte sa laize et son bain ; au retour au stock, son reste est
 * pesé et sa consommation (et son grammage réel) en découle.
 */
export function MatelasRolls({
  workOrderId,
  traceId,
  initial,
  onRoll,
}: {
  workOrderId: string;
  traceId: string;
  initial: MatelasRoll[];
  onRoll: (roll: MatelasRoll) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [rolls, setRolls] = useState<MatelasRoll[]>(initial);
  const bains = new Set(rolls.map((r) => r.bain ?? "—"));

  function add() {
    startTransition(async () => {
      const res = await attachRollToMatelas(code, workOrderId, traceId);
      if (res.error) {
        toast.error("Rouleau refusé", { description: res.error });
        return;
      }
      if (res.roll) {
        const roll = res.roll;
        setRolls((prev) => (prev.some((r) => r.code === roll.code) ? prev : [...prev, roll]));
        onRoll(roll);
      }
      setCode("");
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground-muted">Rouleau(x) utilisé(s) — scannez l&apos;étiquette du rouleau</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <LotCodeInput kind="roll" value={code} onChange={setCode} disabled={pending} placeholder="ROL-AAAA-NNNNN" />
        </div>
        <Button size="md" variant="secondary" loading={pending} disabled={!code.trim()} onClick={add}>
          Ajouter
        </Button>
      </div>
      {rolls.length > 0 && (
        <ul className="space-y-1 text-sm">
          {rolls.map((r) => (
            <li key={r.code} className="flex flex-wrap gap-x-3">
              <span className="font-mono text-xs">{r.code}</span>
              <span className="text-foreground-muted">{r.laizeCm ? `${r.laizeCm} cm` : "laize —"}</span>
              <span className="text-foreground-muted">bain {r.bain ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
      {bains.size > 1 && <p className="text-xs text-warning">Attention : plusieurs bains sur ce matelas (risque de nuance).</p>}
    </div>
  );
}
