"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NewSampleForm } from "@/components/samples/new-sample-form";
import type { SampleRequestOption, SampleQuoteLineOption } from "@/lib/samples";

/**
 * Bouton "Nouvel échantillon" + fenêtre de création — placé dans l'action
 * du `PageHeader` du module Échantillonnage (demande à choisir), dans la
 * carte Échantillons d'une fiche de demande (demande imposée), ou sur une
 * ligne d'article du devis (demande ET article imposés, 0094).
 */
export function CreateSampleDialog({
  requests,
  fixedRequest,
  fixedQuoteLine,
  quoteLines,
  triggerLabel = "Nouvel échantillon",
  triggerVariant,
}: {
  requests?: SampleRequestOption[];
  fixedRequest?: Pick<SampleRequestOption, "id" | "reference" | "companyName">;
  /** Création depuis une ligne d'article précise (ligne de devis). */
  fixedQuoteLine?: { id: string; label: string };
  quoteLines: SampleQuoteLineOption[];
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant={triggerVariant} onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> {triggerLabel}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Nouvelle fiche échantillon"
        description="Un modèle d'échantillon, fabriqué en un exemplaire — rattaché à une demande."
      >
        <NewSampleForm
          requests={requests}
          fixedRequest={fixedRequest}
          fixedQuoteLine={fixedQuoteLine}
          quoteLines={quoteLines}
          onCreated={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
