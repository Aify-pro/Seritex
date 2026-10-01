"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PaymentTerm } from "@/lib/types/domain";
import { addPaymentTerm, deletePaymentTerm, setDefaultPaymentTerm, setPaymentTermActive } from "./actions";

export function PaymentTermsManager({ terms }: { terms: PaymentTerm[] }) {
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else if (success) toast.success(success);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {terms.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className={t.active ? "text-foreground" : "text-foreground-muted line-through"}>{t.label}</span>
            {t.is_default && <Badge tone="success">Par défaut</Badge>}
            {t.is_system && <Badge tone="neutral">De base</Badge>}
            <div className="ml-auto flex items-center gap-1">
              {!t.is_default && t.active && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDefaultPaymentTerm(t.id), "Condition par défaut mise à jour")}>
                  <Star className="h-3.5 w-3.5" /> Par défaut
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPaymentTermActive(t.id, !t.active))}>
                {t.active ? "Désactiver" : "Activer"}
              </Button>
              {!t.is_system && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deletePaymentTerm(t.id), "Condition supprimée")} title="Supprimer">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await addPaymentTerm(label);
            if (!res.error) setLabel("");
            return res;
          }, "Condition ajoutée");
        }}
      >
        <div className="flex-1">
          <label htmlFor="new-term" className="mb-1 block text-xs font-medium text-foreground">
            Nouvelle condition de paiement
          </label>
          <input
            id="new-term"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex. 45 jours fin de mois"
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <Button type="submit" size="sm" loading={pending} disabled={!label.trim()}>
          Ajouter
        </Button>
      </form>
    </div>
  );
}
