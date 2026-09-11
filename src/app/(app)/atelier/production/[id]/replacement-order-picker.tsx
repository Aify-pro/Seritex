"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ArrowRightLeft } from "lucide-react";
import { setReplacementProductionOrder } from "../actions";

type Candidate = { id: string; reference: string; status: string };

/**
 * Lien d'un ODF annulé vers l'ODF qui le remplace. La colonne existait depuis
 * le lot 1 mais rien ne la renseignait : la migration 0009 renvoyait ce geste
 * « à part, une fois le nouvel ODF créé » pour éviter une dépendance
 * circulaire à l'annulation, et ce « à part » n'avait jamais été construit.
 *
 * Les candidats sont les ODF actifs du même client — c'est le serveur qui les
 * filtre, et qui revérifie à l'écriture : cet écran ne fait que proposer.
 */
export function ReplacementOrderPicker({
  productionOrderId,
  current,
  candidates,
  editable,
}: {
  productionOrderId: string;
  current: { id: string; reference: string } | null;
  candidates: Candidate[];
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState("");

  function save(replacementId: string | null) {
    startTransition(async () => {
      const res = await setReplacementProductionOrder(productionOrderId, replacementId);
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(replacementId ? "Ordre de fabrication de remplacement relié" : "Lien retiré");
        setChoice("");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Ordre de fabrication de remplacement"
        description="Cet ODF est annulé. S'il a été relancé sous une autre référence, reliez-les : la continuité de la commande reste lisible depuis les deux fiches."
      />
      <CardBody className="space-y-3">
        {current ? (
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-sm text-foreground">
              <ArrowRightLeft className="mr-1.5 inline h-3.5 w-3.5 text-foreground-muted" />
              Remplacé par{" "}
              <Link href={`/atelier/production/${current.id}`} className="font-medium text-brand hover:underline">
                {current.reference}
              </Link>
            </p>
            {editable && (
              <Button size="sm" variant="ghost" loading={pending} onClick={() => save(null)}>
                Retirer le lien
              </Button>
            )}
          </div>
        ) : !editable ? (
          <p className="text-sm text-foreground-muted">Aucun ordre de fabrication de remplacement relié.</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            Aucun ordre de fabrication actif pour ce client : créez d&apos;abord le nouvel ODF, il apparaîtra ici.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={pending}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground sm:max-w-xs"
            >
              <option value="">Choisir un ordre de fabrication…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reference}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!choice} loading={pending} onClick={() => save(choice)}>
              Relier
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
