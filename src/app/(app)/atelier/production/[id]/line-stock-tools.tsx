"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { splitProductionOrderLine } from "../actions";

export interface StockAvailabilityRow {
  taille: string;
  libelle: string;
  code: string | null;
  demande: number;
  enStock: number | null;
  disponible: number | null;
}

/**
 * Disponible par taille d'un article qui part du Stock (SF-2) : stock du
 * miroir Sage moins les réservations des autres ODF. INDICATIF : un manque
 * est signalé, il ne bloque pas.
 */
export function StockAvailability({ rows }: { rows: StockAvailabilityRow[] }) {
  if (rows.length === 0) return null;
  const manques = rows.filter((r) => r.disponible !== null && r.disponible < r.demande);
  const sansArticle = rows.filter((r) => !r.code);
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2.5">
      <p className="text-xs font-medium text-foreground-muted">Stock de produits finis vierges (indicatif)</p>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <span
            key={r.taille}
            title={r.code ?? "Aucune déclinaison"}
            className={`rounded-md border px-2 py-0.5 text-xs tabular-nums ${
              !r.code || (r.disponible !== null && r.disponible < r.demande) ? "border-warning/40 bg-warning-soft text-warning" : "border-border"
            }`}
          >
            {r.libelle} : {r.demande} demandé(s) / {r.disponible ?? "?"} dispo
          </span>
        ))}
      </div>
      {manques.length > 0 && (
        <p className="flex items-start gap-1 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Stock insuffisant pour {manques.map((m) => m.libelle).join(", ")} — la réservation sera posée quand même ; découpez la ligne pour fabriquer le
          complément.
        </p>
      )}
      {sansArticle.length > 0 && (
        <p className="text-[11px] text-danger">
          Aucune déclinaison pour {sansArticle.map((m) => m.libelle).join(", ")} : générez les déclinaisons du modèle (fiche article), sinon la validation sera
          refusée.
        </p>
      )}
    </div>
  );
}

/** Découper la ligne : déplacer des quantités par taille vers une nouvelle ligne du même article. */
export function SplitLineButton({
  lineId,
  productionOrderId,
  sizes,
}: {
  lineId: string;
  productionOrderId: string;
  sizes: { cle: string; libelle: string; quantite: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [qty, setQty] = useState<Record<string, number>>({});
  const total = Object.values(qty).reduce((a, b) => a + (b || 0), 0);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Split className="h-3.5 w-3.5" /> Découper la ligne
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Découper la ligne"
        description="Les quantités saisies passent sur une nouvelle ligne du même article (ex. une partie prise en stock, une partie fabriquée). Chaque ligne a ensuite son propre parcours."
        size="sm"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <label key={s.cle} className="flex w-20 flex-col items-center gap-1 text-[11px] text-foreground-muted">
                {s.libelle} (sur {s.quantite})
                <input
                  type="number"
                  min={0}
                  max={s.quantite}
                  value={qty[s.cle] || ""}
                  onChange={(e) => setQty({ ...qty, [s.cle]: Math.max(0, Math.floor(Number(e.target.value))) })}
                  className="h-8 w-16 rounded-md border border-border bg-surface px-1 text-center text-sm text-foreground"
                />
              </label>
            ))}
          </div>
          <Button
            loading={pending}
            disabled={total === 0}
            onClick={() =>
              startTransition(async () => {
                const res = await splitProductionOrderLine(lineId, productionOrderId, qty);
                if (res.error) toast.error("Découpage refusé", { description: res.error });
                else {
                  toast.success("Ligne découpée");
                  setOpen(false);
                  setQty({});
                  router.refresh();
                }
              })
            }
          >
            Déplacer {total} pièce(s) vers une nouvelle ligne
          </Button>
        </div>
      </Dialog>
    </>
  );
}
