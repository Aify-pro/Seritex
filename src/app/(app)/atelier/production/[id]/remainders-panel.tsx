"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { settleEnCours } from "../actions";

type Destination = "dechet" | "abandon" | "stock_vierge" | "stock_personnalise" | "livre_client";

/** Un reste d'en-cours : un sous-ODF, une taille. */
export interface RemainderRow {
  workOrderId: string;
  lineDescription: string;
  etape: number;
  section: string;
  categorie: string | null;
  taille: string;
  libelleTaille: string;
  reste: number;
}

const DESTINATION_LABELS: Record<Destination, string> = {
  dechet: "Déchet",
  abandon: "Non prélevé (abandon)",
  stock_vierge: "Terminé → stock PF vierge",
  stock_personnalise: "Terminé → stock personnalisé (gardé pour le client)",
  livre_client: "Terminé → livré et facturé au client",
};

/** Destinations possibles selon la section (SF-4, settle_en_cours). */
function destinationsFor(categorie: string | null, hasClient: boolean): Destination[] {
  if (categorie === "stock") return ["abandon"];
  if (categorie === "coupe") return ["dechet"];
  return hasClient ? ["dechet", "stock_vierge", "stock_personnalise", "livre_client"] : ["dechet", "stock_vierge"];
}

/**
 * Restes à clôturer (SF-4) : la clôture est refusée tant qu'il reste de
 * l'en-cours. Chaque reste est soit terminé par l'atelier (rien à faire ici),
 * soit reçoit une destination. Les pièces « terminées » sont déclarées étape
 * après étape jusqu'à la finition : elles créent le mouvement de stock (ou
 * l'expédition) comme une déclaration ordinaire.
 */
export function RemaindersPanel({ productionOrderId, rows, hasClient }: { productionOrderId: string; rows: RemainderRow[]; hasClient: boolean }) {
  if (rows.length === 0) return null;
  return (
    <Card className="border-warning/30">
      <CardHeader
        title={`Restes à clôturer (${rows.reduce((s, r) => s + r.reste, 0)} pièces)`}
        description="Un reste vierge part en finition puis en stock ; une pièce coupée est à terminer ou en déchet ; un surplus personnalisé est livré au client ou gardé pour lui. Ce que l'atelier termine normalement n'a besoin d'aucune destination."
      />
      <CardBody className="divide-y divide-border p-0">
        {rows.map((r) => (
          <RemainderForm key={`${r.workOrderId}-${r.taille}`} productionOrderId={productionOrderId} row={r} options={destinationsFor(r.categorie, hasClient)} />
        ))}
      </CardBody>
    </Card>
  );
}

function RemainderForm({ productionOrderId, row, options }: { productionOrderId: string; row: RemainderRow; options: Destination[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantite, setQuantite] = useState(String(row.reste));
  const [destination, setDestination] = useState<Destination>(options[0]);
  const [motif, setMotif] = useState("");

  return (
    <div className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[1fr_auto_auto_1fr_auto] sm:items-center">
      <div>
        <p className="font-medium text-foreground">
          {row.lineDescription} — {row.libelleTaille}
        </p>
        <p className="text-xs text-foreground-muted">
          Étape {row.etape} · {row.section} · <span className="font-medium text-warning">{row.reste} en cours</span>
        </p>
      </div>
      <input
        type="number"
        min={1}
        max={row.reste}
        value={quantite}
        onChange={(e) => setQuantite(e.target.value)}
        className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-sm"
        aria-label="Quantité"
      />
      <select
        value={destination}
        onChange={(e) => setDestination(e.target.value as Destination)}
        className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
        aria-label="Destination"
      >
        {options.map((d) => (
          <option key={d} value={d}>
            {DESTINATION_LABELS[d]}
          </option>
        ))}
      </select>
      <input
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        placeholder="Motif (obligatoire)"
        className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
      />
      <Button
        size="sm"
        loading={pending}
        disabled={!motif.trim() || !(Number(quantite) > 0)}
        onClick={() =>
          startTransition(async () => {
            const res = await settleEnCours(productionOrderId, {
              workOrderId: row.workOrderId,
              taille: row.taille,
              quantite: Number(quantite),
              destination,
              motif,
            });
            if (res.error) toast.error("Destination non enregistrée", { description: res.error });
            else {
              toast.success("Destination enregistrée");
              router.refresh();
            }
          })
        }
      >
        Valider
      </Button>
    </div>
  );
}
