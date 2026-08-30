"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NewSampleForm } from "@/components/samples/new-sample-form";

/**
 * Remplace l'ancien formulaire de création systématiquement affiché en haut
 * du module : le bouton "Nouvelle demande" ouvre désormais une fenêtre
 * interne dédiée plutôt que d'occuper en permanence la place au-dessus de
 * la liste. Composant autonome (bouton déclencheur + fenêtre) à placer
 * directement dans l'action du `PageHeader`.
 */
export function CreateSampleDialog({
  companies,
  fixedCompanyId,
  canSetPriority = false,
}: {
  companies?: { id: string; name: string }[];
  fixedCompanyId?: string;
  canSetPriority?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Nouvelle demande
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Nouvelle demande d'échantillon"
        description="Besoin exprimé, quantité et fichiers de référence — la fiche complète."
      >
        <NewSampleForm
          companies={companies}
          fixedCompanyId={fixedCompanyId}
          canSetPriority={canSetPriority}
          onCreated={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
