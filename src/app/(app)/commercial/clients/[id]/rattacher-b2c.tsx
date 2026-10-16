"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/clients/company-picker";
import type { CompanySearchResult } from "@/lib/actions/companies";
import { rattacherB2CAEntreprise } from "../actions";
import { Link2 } from "lucide-react";

/** Fiche B2C : l'enregistrer comme contact d'une entreprise (la fiche et son historique sont conservés). */
export function RattacherB2C({ b2cId }: { b2cId: string }) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Link2 className="h-3.5 w-3.5" /> Rattacher à une entreprise
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-2 rounded-md border border-border bg-surface-muted/50 p-3 text-xs">
      <p className="text-foreground-muted">
        Le particulier devient contact de l&apos;entreprise choisie, avec son compte portail s&apos;il en a un : il verra alors les
        devis et commandes de cette entreprise. Cette fiche et son historique sont conservés.
      </p>
      <CompanyPicker name="company_id" onChange={setCompany} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!company}
          loading={pending}
          onClick={() =>
            company &&
            startTransition(async () => {
              const res = await rattacherB2CAEntreprise(b2cId, company.id);
              if (res.error) toast.error("Rattachement impossible", { description: res.error });
              else {
                toast.success(`Contact rattaché à ${company.name}`);
                setOpen(false);
              }
            })
          }
        >
          Confirmer le rattachement
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
