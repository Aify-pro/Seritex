"use client";

import { useTransition, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createSampleRequest } from "@/lib/actions/samples";
import { SAMPLE_PRIORITY_LABELS, type SamplePriority } from "@/lib/types/domain";
import { Plus } from "lucide-react";

const PRIORITIES: SamplePriority[] = ["basse", "normale", "haute", "urgente"];

export function NewSampleForm({
  companies,
  fixedCompanyId,
  canSetPriority = false,
}: {
  companies?: { id: string; name: string }[];
  fixedCompanyId?: string;
  /** Priorité et délai réservés au staff (section 2.1) — masqués pour le client. */
  canSetPriority?: boolean;
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
      <textarea
        name="extra_info"
        rows={2}
        placeholder="Informations complémentaires (optionnel)"
        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
      />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Quantité</label>
          <input
            name="quantity_requested"
            type="number"
            min={1}
            defaultValue={1}
            className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Date de la demande</label>
          <input
            name="request_date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        {canSetPriority && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Priorité</label>
              <select name="priority" defaultValue="normale" className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {SAMPLE_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Délai souhaité</label>
              <input name="due_date" type="date" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
            </div>
          </>
        )}
        <Button type="submit" size="sm" loading={pending}>
          <Plus className="h-3.5 w-3.5" /> Créer la demande
        </Button>
      </div>
    </form>
  );
}
