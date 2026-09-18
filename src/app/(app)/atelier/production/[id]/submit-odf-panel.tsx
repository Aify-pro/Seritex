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
 *
 * `comptabiliteOk`/`infographieOk`/`echantillonsOk` reflètent, côté client,
 * les mêmes gates que submit_production_order() (migration 0050, circuit de
 * validation) — seulement pour désactiver le bouton avec un message clair
 * avant de tenter : le contrôle qui fait autorité reste le RPC.
 */
export function SubmitOdfPanel({
  productionOrderId,
  anySectionChosen,
  linesConfigured,
  comptabiliteOk,
  infographieOk,
  echantillonsOk,
}: {
  productionOrderId: string;
  anySectionChosen: boolean;
  linesConfigured: boolean;
  comptabiliteOk: boolean;
  infographieOk: boolean;
  echantillonsOk: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await submitProductionOrder(productionOrderId);
      if (res.error) toast.error("Soumission refusée", { description: res.error });
      else toast.success("Ordre de fabrication soumis pour validation");
    });
  }

  const disabled = !anySectionChosen || !linesConfigured || !comptabiliteOk || !infographieOk || !echantillonsOk;

  const circuitMessage = !comptabiliteOk
    ? "La validation comptabilité (compte client) est requise avant soumission — voir « Circuit de validation » ci-dessus."
    : !infographieOk
      ? "La validation infographie (visuels) est requise avant soumission — voir « Circuit de validation » ci-dessus."
      : !echantillonsOk
        ? "Au moins un article porte un échantillon lié qui n'a pas encore le statut « Validé » — voir « Circuit de validation » ci-dessus."
        : null;

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
                : (circuitMessage ?? undefined)
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
        {anySectionChosen && linesConfigured && circuitMessage && <p className="text-xs text-warning">{circuitMessage}</p>}
      </CardBody>
    </Card>
  );
}
