"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClientRequest } from "@/lib/actions/requests";

export function ClientNewRequestForm() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await createClientRequest(formData);
          if (res.error) toast.error(res.error);
          else {
            toast.success("Demande envoyée");
            router.push(`/client/demandes/${res.requestId}`);
          }
        })
      }
      className="max-w-xl space-y-4"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Décrivez votre besoin</label>
        <textarea
          name="description"
          required
          rows={5}
          className="w-full rounded-md border border-border bg-surface p-3 text-sm"
          placeholder="Ex : 200 T-shirts floqués pour notre équipe, coloris bleu marine, livraison avant le 15/09..."
        />
      </div>
      <Button type="submit" loading={pending}>
        Envoyer la demande
      </Button>
    </form>
  );
}
