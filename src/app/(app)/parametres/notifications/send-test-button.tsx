"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { sendTestNotification } from "./actions";

export function SendTestButton({ eventKey }: { eventKey: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await sendTestNotification(eventKey);
          if (res?.error) toast.error(res.error);
          else toast.success("Email de test envoyé — voir l'historique ci-dessous.");
        })
      }
    >
      <Send className="h-3.5 w-3.5" /> Envoyer un test
    </Button>
  );
}
