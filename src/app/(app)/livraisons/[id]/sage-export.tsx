"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { generateShipmentStockExportFiche } from "../../atelier/stock/actions";

/**
 * Export Sage du bon de livraison (LIV-3) : à la livraison ou à l'enlèvement,
 * une sortie PF est enregistrée par article ; cette fiche la reprend pour
 * l'import dans Sage (format provisoire, avec dépôt).
 */
export function ShipmentSageExport({
  shipmentId,
  movements,
  fiches,
}: {
  shipmentId: string;
  movements: { id: string; article: string | null; taille: string | null; quantite: number; depot: string | null; exported: boolean }[];
  fiches: { numero: string; generatedAt: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unexported = movements.filter((m) => !m.exported).length;
  if (movements.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Sortie de stock (Sage)"
        description="Sorties PF enregistrées à la livraison, sur l'article entré à la finition."
        action={
          unexported > 0 ? (
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await generateShipmentStockExportFiche(shipmentId);
                  if ("error" in res) toast.error("Fiche non générée", { description: res.error });
                  else {
                    toast.success(`Fiche ${res.numero} générée`);
                    router.refresh();
                  }
                })
              }
            >
              Générer la fiche du BL ({unexported})
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-2 text-sm">
        <ul className="divide-y divide-border">
          {movements.map((m) => (
            <li key={m.id} className="flex justify-between gap-3 py-1.5">
              <span className="font-mono text-xs">{m.article ?? "Référence à compléter"}</span>
              <span className="text-xs text-foreground-muted">
                {m.taille?.split("/").pop()} · {m.quantite} pièce(s) · dépôt {m.depot ?? "—"} · {m.exported ? "exporté" : "non exporté"}
              </span>
            </li>
          ))}
        </ul>
        {fiches.map((f) => (
          <Link key={f.numero} href={`/stock/fiches/${f.numero}`} className="block text-xs font-medium text-brand hover:underline">
            {f.numero} →
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
