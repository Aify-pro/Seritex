"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMovementUnit } from "@/lib/stock/movements";
import { adjustConsumption } from "../actions";

export interface ConsumptionRow {
  id: string;
  article: string;
  code: string;
  designation: string;
  unite: string;
  pieces: number;
  theorique: number;
  reelle: number | null;
  motif: string | null;
  sortie: boolean;
}

/**
 * Consommables de l'ODF (COM-G) : consommation théorique (nomenclature ×
 * pièces finies) calculée à la demande de clôture, ajustable avec un motif
 * jusqu'à la clôture, qui crée les sorties de stock pour Sage.
 */
export function ConsumptionPanel({ productionOrderId, rows, editable }: { productionOrderId: string; rows: ConsumptionRow[]; editable: boolean }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Consommables"
        description={
          editable
            ? "Consommation théorique = nomenclature × pièces finies (1er + 2e choix). Ajustez si besoin avant la clôture : les sorties de stock sont créées à la clôture."
            : "Consommation retenue pour cet ordre de fabrication."
        }
      />
      <CardBody className="divide-y divide-border p-0">
        {rows.map((r) => (
          <Row key={r.id} productionOrderId={productionOrderId} row={r} editable={editable && !r.sortie} />
        ))}
      </CardBody>
    </Card>
  );
}

function Row({ productionOrderId, row, editable }: { productionOrderId: string; row: ConsumptionRow; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qte, setQte] = useState(String(row.reelle ?? row.theorique));
  const [motif, setMotif] = useState(row.motif ?? "");
  const unite = formatMovementUnit(row.unite);
  return (
    <div className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
      <div>
        <p className="font-medium text-foreground">
          <span className="mr-1.5 font-mono text-xs text-foreground-muted">{row.code}</span>
          {row.designation}
        </p>
        <p className="text-xs text-foreground-muted">
          {row.article} · {row.pieces} pièce(s) · théorique {row.theorique} {unite}
        </p>
      </div>
      {editable ? (
        <>
          <input
            type="number"
            min={0}
            step="0.001"
            value={qte}
            onChange={(e) => setQte(e.target.value)}
            className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-sm"
            aria-label="Quantité réelle"
          />
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Motif (si différent du théorique)"
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
          />
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await adjustConsumption(productionOrderId, row.id, Number(qte), motif);
                if (res.error) toast.error("Ajustement refusé", { description: res.error });
                else {
                  toast.success("Consommation enregistrée");
                  router.refresh();
                }
              })
            }
          >
            Enregistrer
          </Button>
        </>
      ) : (
        <p className="text-sm sm:col-span-3 sm:text-right">
          {row.reelle ?? row.theorique} {unite}
          {row.motif ? <span className="text-xs text-foreground-muted"> · {row.motif}</span> : null}{" "}
          {row.sortie && <Badge tone="neutral">Sortie créée</Badge>}
        </p>
      )}
    </div>
  );
}
