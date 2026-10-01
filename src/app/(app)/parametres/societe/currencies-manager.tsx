"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Currency } from "@/lib/types/domain";
import { addCurrency, setCurrencyActive, updateCurrencyRate } from "./actions";

function RateInput({ currency }: { currency: Currency }) {
  const [value, setValue] = useState(currency.rate_xof != null ? String(currency.rate_xof) : "");
  const [pending, startTransition] = useTransition();
  const dirty = value !== (currency.rate_xof != null ? String(currency.rate_xof) : "");

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-foreground-muted">1 {currency.code} =</span>
      <input
        type="number"
        min={0}
        step="0.000001"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-sm"
      />
      <span className="text-xs text-foreground-muted">F CFA</span>
      {dirty && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateCurrencyRate(currency.code, value);
              if (res.error) toast.error(res.error);
              else toast.success(`Taux ${currency.code} enregistré`);
            })
          }
        >
          Enregistrer
        </Button>
      )}
    </div>
  );
}

export function CurrenciesManager({ currencies }: { currencies: Currency[] }) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [rate, setRate] = useState("");

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {currencies.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="w-12 font-medium text-foreground">{c.code}</span>
            <span className="text-foreground-muted">{c.label}</span>
            {c.is_base ? <Badge tone="neutral">Devise de base</Badge> : c.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
            {!c.is_base && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <RateInput currency={c} />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await setCurrencyActive(c.code, !c.active);
                      if (res.error) toast.error(res.error);
                    })
                  }
                >
                  {c.active ? "Désactiver" : "Activer"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form
        className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[6rem_1fr_9rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await addCurrency(code, label, rate);
            if (res.error) toast.error(res.error);
            else {
              toast.success("Devise ajoutée");
              setCode("");
              setLabel("");
              setRate("");
            }
          });
        }}
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Code ISO</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={3} placeholder="CAD" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Libellé</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Dollar canadien" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">1 unité = … F CFA</label>
          <input type="number" min={0} step="0.000001" value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
        <Button type="submit" size="sm" loading={pending} disabled={!code || !label || !rate}>
          Ajouter
        </Button>
      </form>
    </div>
  );
}
