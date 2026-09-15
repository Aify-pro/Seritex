"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Send } from "lucide-react";
import { submitProductionOrder } from "../actions";

/**
 * Soumission de l'ODF pour validation — les sections retenues de chaque
 * article sont déjà enregistrées au fil de l'eau (LineSectionsPicker,
 * migration 0037), donc plus de bouton "brouillon" séparé ici : ce panneau
 * ne fait plus que déclencher submit_production_order().
 */
export function SubmitOdfPanel({
  productionOrderId,
  anySectionChosen,
  linesConfigured,
}: {
  productionOrderId: string;
  anySectionChosen: boolean;
  linesConfigured: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await submitProductionOrder(productionOrderId);
      if (res.error) toast.error("Soumission refusée", { description: res.error });
      else toast.success("Ordre de fabrication soumis pour validation");
    });
  }

  const disabled = !anySectionChosen || !linesConfigured;

  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-2">
        <Button
          onClick={submit}
          loading={pending}
          disabled={disabled}
          title={
            !linesConfigured
              ? "Chaque article doit avoir son modèle, sa couleur et son dispatching des tailles au complet (voir Configuration produit ci-dessus)."
              : !anySectionChosen
                ? "Retenez au moins une section sur au moins un article avant de soumettre."
                : undefined
          }
        >
          <Send className="h-3.5 w-3.5" /> Soumettre pour validation
        </Button>
        {anySectionChosen && !linesConfigured && (
          <p className="text-xs text-warning">
            La soumission attend, pour chaque article : un modèle, une couleur (par zone, ou « modèle uni ») et un
            dispatching des tailles totalisant exactement sa quantité — voir « Configuration produit » ci-dessus.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
