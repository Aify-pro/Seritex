"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateStockExportFiche } from "../actions";
import { formatDateTime } from "@/lib/utils";
import type { StockMovement, StockExportFiche } from "@/lib/types/domain";

const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  sortie_mp: "Sortie MP",
  entree_semi_fini: "Entrée semi-fini",
  sortie_semi_fini: "Sortie semi-fini",
  entree_fini: "Entrée fini",
  retour_mp: "Retour MP",
};

/**
 * Lot 10 — mouvements de stock & fiches d'import Sage (section 19 du
 * document de logique). Seritex n'écrit jamais directement dans Sage : une
 * fiche numérotée regroupe les mouvements pas encore exportés, à importer
 * manuellement côté Sage. Générable à tout moment tant que l'ODF est
 * ouvert — livraisons partielles possibles.
 */
export function StockMovementsPanel({
  productionOrderId,
  movements,
  fiches,
  canGenerate,
}: {
  productionOrderId: string;
  movements: StockMovement[];
  fiches: StockExportFiche[];
  canGenerate: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const unexportedCount = movements.filter((m) => !m.exported_in_fiche_id).length;

  function generate() {
    startTransition(async () => {
      const res = await generateStockExportFiche(productionOrderId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Fiche ${res.numero} générée`);
    });
  }

  if (movements.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Mouvements de stock"
        description="Fiches d'import Sage — Seritex n'écrit jamais directement dans Sage, seulement des fiches à importer manuellement."
        action={
          canGenerate && unexportedCount > 0 ? (
            <Button size="sm" onClick={generate} loading={pending}>
              Générer une fiche ({unexportedCount})
            </Button>
          ) : undefined
        }
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">
          {movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm text-foreground">
                  {STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type} · {m.quantite_ou_poids} {m.unite === "kg" ? "kg" : "pièce(s)"}
                </p>
                <p className="text-xs text-foreground-muted">
                  {m.article_ref ? `Article ${m.article_ref}` : "Référence Sage non renseignée"} · {formatDateTime(m.created_at)}
                </p>
              </div>
              <Badge tone={m.exported_in_fiche_id ? "neutral" : "warning"}>
                {m.exported_in_fiche_id ? "Exporté" : "Non exporté"}
              </Badge>
            </li>
          ))}
        </ul>
        {fiches.length > 0 && (
          <div className="border-t border-border px-5 py-3">
            <p className="mb-2 text-xs font-medium text-foreground-muted">Fiches générées</p>
            <ul className="space-y-1">
              {fiches.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/stock/fiches/${f.numero}`}
                    target="_blank"
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    {f.numero} — générée le {formatDateTime(f.generated_at)} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
