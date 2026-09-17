"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { NotificationStyleSettings } from "@/lib/types/domain";
import { updateNotificationStyleSettings } from "./actions";

export function StyleSettingsForm({ style }: { style: NotificationStyleSettings }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [brandColor, setBrandColor] = useState(style.brand_color);

  function save() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      const res = await updateNotificationStyleSettings(style.id, formData);
      if (res?.error) toast.error(res.error);
      else toast.success("Image de marque mise à jour");
    });
  }

  return (
    <form ref={formRef} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Nom d&apos;expéditeur</label>
          <input
            name="sender_name"
            defaultValue={style.sender_name}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">
            Adresse expéditeur (domaine vérifié Resend)
          </label>
          <input
            name="sender_email"
            type="email"
            defaultValue={style.sender_email ?? ""}
            placeholder="notifications@votre-domaine.com"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Couleur de marque</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-9 w-12 rounded border border-border"
            />
            <input
              type="text"
              name="brand_color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Logo (URL, optionnel)</label>
          <input
            name="logo_url"
            defaultValue={style.logo_url ?? ""}
            placeholder="https://…"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">URL de base de l&apos;application</label>
          <input
            name="app_base_url"
            defaultValue={style.app_base_url ?? ""}
            placeholder="https://app.votre-domaine.com"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Pied de page</label>
        <input
          name="footer_text"
          defaultValue={style.footer_text ?? ""}
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" loading={pending} onClick={save}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
