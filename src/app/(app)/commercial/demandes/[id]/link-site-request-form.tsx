"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/clients/company-picker";
import type { CompanySearchResult } from "@/lib/actions/companies";
import { linkSiteRequestToCompany } from "./site-actions";

export function LinkSiteRequestForm({ requestId, suggestion }: { requestId: string; suggestion: string }) {
  const router = useRouter();
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-muted">
        Recherchez « {suggestion} » ou le code Sage du nouveau client.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <CompanyPicker name="company_id" onChange={setCompany} />
        </div>
        <Button
          disabled={!company}
          loading={pending}
          onClick={() =>
            company &&
            startTransition(async () => {
              const res = await linkSiteRequestToCompany(requestId, company.id);
              if (res.error) toast.error("Rattachement impossible", { description: res.error });
              else {
                toast.success(`Demande rattachée à ${company.name}`);
                router.refresh();
              }
            })
          }
        >
          Rattacher
        </Button>
      </div>
    </div>
  );
}
