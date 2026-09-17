"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateNotificationEventTemplate } from "./actions";

export function EventTemplateForm({
  eventId,
  subjectTemplate,
  bodyTemplate,
  availableVariables,
}: {
  eventId: string;
  subjectTemplate: string;
  bodyTemplate: string;
  availableVariables: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      const res = await updateNotificationEventTemplate(eventId, formData);
      if (res?.error) toast.error(res.error);
      else toast.success("Message enregistré");
    });
  }

  return (
    <form ref={formRef} className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Sujet</label>
        <input
          name="subject_template"
          defaultValue={subjectTemplate}
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Message (HTML)</label>
        <textarea
          name="body_template"
          defaultValue={bodyTemplate}
          rows={4}
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground font-mono"
        />
      </div>
      {availableVariables && (
        <p className="text-xs text-foreground-muted">
          Variables disponibles :{" "}
          {availableVariables
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => `{{${v}}}`)
            .join(", ")}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="secondary" loading={pending} onClick={save}>
          Enregistrer le message
        </Button>
      </div>
    </form>
  );
}
