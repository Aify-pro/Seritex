"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NewSampleForm } from "@/components/samples/new-sample-form";
import type { SampleRequestOption, SampleQuoteLineOption } from "@/lib/samples";

/**
 * Bouton "Nouvel échantillon" + fenêtre de création — placé dans l'action
 * du `PageHeader` du module Échantillonnage (demande à choisir) ou dans la
 * carte Échantillons d'une fiche de demande (demande imposée).
 */
export function CreateSampleDialog({
  requests,
  fixedRequest,
  quoteLines,
}: {
  requests?: SampleRequestOption[];
  fixedRequest?: Pick<SampleRequestOption, "id" | "reference" | "companyName">;
  quoteLines: SampleQuoteLineOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nouvel échantillon
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
          quoteLines={quoteLines}
          onCreated={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
