"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export type Message = {
  id: string;
  body: string;
  created_at: string;
  sender_id: string;
  app_users?: { full_name: string } | null;
};

export function MessageThread({
  messages,
  currentUserId,
  action,
}: {
  messages: Message[];
  currentUserId: string;
  action: (formData: FormData) => Promise<{ error?: string } | undefined>;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col">
      <div className="max-h-80 space-y-3 overflow-y-auto p-5 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-sm text-foreground-muted">Aucun message pour le moment.</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === currentUserId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                  mine ? "bg-brand text-brand-foreground" : "bg-surface-muted text-foreground"
                }`}
              >
                <p>{m.body}</p>
                <p className={`mt-1 text-[10px] ${mine ? "text-white/70" : "text-foreground-muted"}`}>
                  {m.app_users?.full_name ?? "—"} · {formatDateTime(m.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            const res = await action(formData);
            if (res?.error) toast.error(res.error);
            else formRef.current?.reset();
          })
        }
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          name="body"
          placeholder="Écrire un message..."
          required
          className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
        />
        <Button type="submit" size="sm" loading={pending}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
