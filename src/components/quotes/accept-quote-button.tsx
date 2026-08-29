"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptQuote } from "@/app/(app)/commercial/actions";
import { CheckCircle2 } from "lucide-react";

export function AcceptQuoteButton({ quoteId }: { quoteId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="success"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await acceptQuote(quoteId);
          if (res.error) toast.error("Impossible de valider ce devis", { description: res.error });
          else {
            toast.success("Devis validé — l'ordre de fabrication a été créé.");
            router.refresh();
          }
        })
      }
    >
      <CheckCircle2 className="h-4 w-4" />
      Valider ce devis
    </Button>
  );
}
