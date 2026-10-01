"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { rejectQuote, validateQuote } from "@/app/(app)/commercial/actions";

/**
 * Validation interne d'une proforma (migration 0063) : la personne habilitée
 * (signature enregistrée) valide — ce qui envoie le devis au client — ou le
 * renvoie au commercial avec un motif. Les autres voient seulement l'attente.
 */
export function ValidateQuoteCard({ quoteId, canValidate, validators }: { quoteId: string; canValidate: boolean; validators: string[] }) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [motif, setMotif] = useState("");

  return (
    <Card className="border-warning/40 bg-warning-soft/40">
      <CardBody className="space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground">En attente de validation interne</p>
          <p className="text-xs text-foreground-muted">
            Ce devis n&apos;est pas visible du client et ne lui a pas été envoyé. Seules les personnes habilitées (signature enregistrée) peuvent le valider
            {validators.length > 0 ? ` : ${validators.join(", ")}.` : "."}
          </p>
        </div>

        {canValidate ? (
          rejecting ? (
            <div className="space-y-2">
              <label htmlFor="rejet-motif" className="block text-xs font-medium text-foreground">
                Motif du renvoi au commercial
              </label>
              <textarea
                id="rejet-motif"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  loading={pending}
                  disabled={motif.trim().length < 3}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await rejectQuote(quoteId, motif);
                      if (res.error) toast.error(res.error);
                      else toast.success("Devis renvoyé au commercial");
                    })
                  }
                >
                  Renvoyer
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await validateQuote(quoteId);
                    if (res.error) toast.error(res.error);
                    else toast.success("Devis validé et envoyé au client");
                  })
                }
              >
                Valider et envoyer au client
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>
                Renvoyer au commercial
              </Button>
            </div>
          )
        ) : (
          <p className="text-xs text-foreground-muted">Votre compte n&apos;est pas habilité à valider les devis.</p>
        )}
      </CardBody>
    </Card>
  );
}
