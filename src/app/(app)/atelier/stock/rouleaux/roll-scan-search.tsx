"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LotCodeInput } from "@/components/atelier/lot-code-input";

/** Recherche d'un rouleau par scan de son étiquette (ou saisie du code). */
export function RollScanSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initial);
  const go = (c: string) => router.push(c.trim() ? `/atelier/stock?onglet=rouleaux&q=${encodeURIComponent(c.trim())}` : "/atelier/stock?onglet=rouleaux");
  return (
    <div className="flex items-end gap-2">
      <div className="w-72">
        <span className="mb-1 block text-xs text-foreground-muted">Scanner un rouleau</span>
        <LotCodeInput
          kind="roll"
          value={code}
          onChange={(c) => {
            setCode(c);
            // Un code complet (douchette ou caméra) lance la recherche.
            if (/^ROL-\d{4}-\d{5}$/.test(c)) go(c);
          }}
          placeholder="ROL-AAAA-NNNNN"
        />
      </div>
    </div>
  );
}
