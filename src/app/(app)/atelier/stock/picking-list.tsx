"use client";

import { useState } from "react";
import { PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Size } from "@/lib/sizes";
import type { WorkOrderFlowRow } from "@/lib/types/domain";
import { DeclarationDialog } from "../section/declaration-dialog";
import { SizesContext } from "../section/types";

export interface PickingRow {
  workOrderId: string;
  reference: string;
  odfReference: string;
  client: string;
  article: string;
  flow: WorkOrderFlowRow[];
}

/**
 * Prélèvements à faire (SF-2) : les sous-ODF des sections Stock dont il
 * reste des pièces à sortir. Le gestionnaire déclare le prélèvement réel par
 * taille — chaque déclaration crée une sortie PF pour Sage.
 */
export function PickingList({ rows, sizes }: { rows: PickingRow[]; sizes: Size[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = rows.find((r) => r.workOrderId === open) ?? null;
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;

  return (
    <SizesContext.Provider value={sizes}>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-foreground-muted">Aucun prélèvement en attente.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.workOrderId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium">
                  {r.odfReference} · {r.client}
                </p>
                <p className="text-xs text-foreground-muted">
                  {r.article} — à prélever :{" "}
                  {r.flow
                    .filter((f) => f.reste > 0)
                    .map((f) => `${libelle(f.taille)} ${f.reste}`)
                    .join(", ")}
                </p>
              </div>
              <Button size="sm" onClick={() => setOpen(r.workOrderId)}>
                <PackageOpen className="h-3.5 w-3.5" /> Déclarer le prélèvement
              </Button>
            </li>
          ))}
        </ul>
      )}
      {current && (
        <DeclarationDialog
          key={current.workOrderId}
          open
          onOpenChange={(o) => !o && setOpen(null)}
          workOrderId={current.workOrderId}
          workOrderReference={current.reference}
          categorie="stock"
          flow={current.flow}
        />
      )}
    </SizesContext.Provider>
  );
}
