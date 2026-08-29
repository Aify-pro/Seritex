"use client";

import { useTransition, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createSampleRequest } from "@/lib/actions/samples";
import { Plus } from "lucide-react";

export function NewSampleForm({
  companies,
  fixedCompanyId,
}: {
  companies?: { id: string; name: string }[];
  fixedCompanyId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createSampleRequest(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Demande d'échantillon créée");
            formRef.current?.reset();
          }
        })
      }
      className="space-y-3 rounded-md border border-dashed border-border p-4"
    >
      <p className="text-sm font-medium text-foreground">Nouvelle demande d&apos;échantillon</p>
      {fixedCompanyId ? (
        <input type="hidden" name="company_id" value={fixedCompanyId} />
      ) : (
        <select name="company_id" required className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">— Entreprise —</option>
          {companies?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        name="need_description"
        required
        rows={2}
        placeholder="Besoin exprimé (coloris, matière, visuel de référence...)"
        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
      />
      <input
        name="quantity_requested"
        type="number"
        min={1}
        defaultValue={1}
        className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
      />
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Créer la demande
      </Button>
    </form>
  );
}
