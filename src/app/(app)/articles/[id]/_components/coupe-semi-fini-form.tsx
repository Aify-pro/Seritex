"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateCoupeSemiFini } from "../../actions";

export interface CoupeSemiFini {
  coupeOuvert: boolean;
  coupeTubulaire: boolean;
  piecesOuvert: number;
  piecesTubulaire: number;
}

const champ = "h-9 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm disabled:opacity-60";

/**
 * Coupe d'un semi-fini (0180) : tissu ouvert, tubulaire ou les deux, et le
 * nombre de pièces que donne un contour du tracé sur chacun. Un même patron
 * posé dans un tube donne 2 pièces (deux faces) ; un demi-semi-fini posé au
 * pli en donne 1.
 */
export function CoupeSemiFiniForm({ productModelId, initial, editable }: { productModelId: string; initial: CoupeSemiFini; editable: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const modifie = JSON.stringify(v) !== JSON.stringify(initial);

  function enregistrer() {
    startTransition(async () => {
      const res = await updateCoupeSemiFini(productModelId, v);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Coupe du semi-fini enregistrée");
        router.refresh();
      }
    });
  }

  const ligne = (cle: "Ouvert" | "Tubulaire", aide: string) => {
    const coche = cle === "Ouvert" ? v.coupeOuvert : v.coupeTubulaire;
    const pieces = cle === "Ouvert" ? v.piecesOuvert : v.piecesTubulaire;
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
        <label className="flex min-w-40 items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={coche}
            disabled={!editable || pending}
            onChange={(e) => setV((x) => (cle === "Ouvert" ? { ...x, coupeOuvert: e.target.checked } : { ...x, coupeTubulaire: e.target.checked }))}
          />
          Tissu {cle.toLowerCase()}
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="number"
            min={1}
            max={20}
            value={pieces}
            disabled={!editable || pending || !coche}
            onChange={(e) => {
              const n = Math.max(1, Math.trunc(Number(e.target.value) || 1));
              setV((x) => (cle === "Ouvert" ? { ...x, piecesOuvert: n } : { ...x, piecesTubulaire: n }));
            }}
            className={champ}
            aria-label={`Pièces par contour sur tissu ${cle.toLowerCase()}`}
          />
          pièce(s) par contour du tracé
        </label>
        <span className="w-full text-xs text-foreground-muted">{aide}</span>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {ligne("Ouvert", "En général 1 : une couche de tissu ouvert, un contour = une pièce.")}
      {ligne("Tubulaire", "2 si la pièce entière est posée dans le tube (deux faces) ; 1 pour un demi-semi-fini posé sur le pli du tube.")}
      {!v.coupeOuvert && !v.coupeTubulaire && <p className="text-xs text-danger">Cochez au moins une forme de tissu.</p>}
      {editable && (
        <div className="flex justify-end">
          <Button size="sm" disabled={!modifie || (!v.coupeOuvert && !v.coupeTubulaire)} loading={pending} onClick={enregistrer}>
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}
