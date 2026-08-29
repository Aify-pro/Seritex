"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createQuote } from "../../actions";
import { useRouter } from "next/navigation";

type ProductModel = { id: string; name: string; base_price: number | null };

export function QuoteForm({
  requestId,
  companyId,
  products,
}: {
  requestId: string;
  companyId: string;
  products: ProductModel[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Établir un devis
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createQuote(requestId, companyId, formData);
          if (res.error) toast.error(res.error);
          else {
            toast.success("Devis créé et envoyé au client");
            setOpen(false);
            router.refresh();
          }
        })
      }
      className="space-y-3 rounded-md border border-border bg-surface-muted/50 p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Produit</label>
          <select
            name="product_model_id"
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            onChange={(e) => {
              const opt = products.find((p) => p.id === e.target.value);
              const priceInput = formRef.current?.elements.namedItem("unit_price") as HTMLInputElement | null;
              const descInput = formRef.current?.elements.namedItem("description") as HTMLInputElement | null;
              if (opt && priceInput) priceInput.value = String(opt.base_price ?? "");
              if (opt && descInput && !descInput.value) descInput.value = opt.name;
            }}
          >
            <option value="">— Sélectionner —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Description de la ligne</label>
          <input
            name="description"
            required
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Quantité</label>
          <input
            name="quantity"
            type="number"
            min={1}
            required
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Prix unitaire</label>
          <input
            name="unit_price"
            type="number"
            min={0}
            step="0.01"
            required
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Envoyer le devis au client
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
