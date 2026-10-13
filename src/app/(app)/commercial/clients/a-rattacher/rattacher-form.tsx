"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/clients/company-picker";
import type { CompanySearchResult } from "@/lib/actions/companies";
import { rattacherCompteB2B, rattacherCompteB2C } from "../actions";

/** Rattachement d'un compte du site : à une société Sage (B2B) ou à une nouvelle fiche particulier (B2C). */
export function RattacherForm({ userId, nom, suggestion }: { userId: string; nom: string; suggestion: string }) {
  const router = useRouter();
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [pending, startTransition] = useTransition();

  function terminer(res: { error?: string }, message: string) {
    if (res.error) toast.error("Rattachement impossible", { description: res.error });
    else {
      toast.success(message);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <p className="mb-1 text-xs text-foreground-muted">B2B — recherchez « {suggestion} » ou le code Sage de la société.</p>
          <CompanyPicker name="company_id" onChange={setCompany} />
        </div>
        <Button
          className="sm:mt-5"
          disabled={!company}
          loading={pending}
          onClick={() => company && startTransition(async () => terminer(await rattacherCompteB2B(userId, company.id), `${nom} rattaché à ${company.name}`))}
        >
          Rattacher à la société
        </Button>
      </div>
      <div className="flex items-center gap-3 border-t border-border pt-3">
        <p className="flex-1 text-xs text-foreground-muted">B2C — particulier : on crée sa fiche client dans la plateforme (facturation « client divers » dans Sage).</p>
        <Button
          variant="secondary"
          loading={pending}
          onClick={() => startTransition(async () => terminer(await rattacherCompteB2C(userId), `Fiche particulier créée pour ${nom}`))}
        >
          Créer une fiche B2C
        </Button>
      </div>
    </div>
  );
}
