"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStorageTarget } from "@/lib/actions/media";
import type { StorageBackendType } from "@/lib/types/domain";
import { Plus } from "lucide-react";

const TYPES: { value: StorageBackendType; label: string }[] = [
  { value: "google_drive", label: "Google Drive" },
  { value: "nas", label: "NAS" },
  { value: "local_server", label: "Serveur local" },
  { value: "supabase_storage", label: "Supabase Storage (bucket additionnel)" },
];

export function NewStorageTargetForm() {
  const [type, setType] = useState<StorageBackendType>("google_drive");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createStorageTarget(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Cible de stockage créée");
            formRef.current?.reset();
          }
        })
      }
      className="space-y-3 rounded-md border border-dashed border-border p-4"
    >
      <p className="text-sm font-medium text-foreground">Nouvelle cible de stockage</p>
      <div className="flex flex-wrap gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Type</label>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as StorageBackendType)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-foreground">Nom (interne)</label>
          <input
            name="name"
            required
            placeholder="Ex : Drive Seritex, NAS atelier..."
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
      </div>

      {type === "supabase_storage" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Nom du bucket</label>
          <input name="bucket" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
      )}

      {type === "google_drive" && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Dossier racine (ID Drive)</label>
            <input name="root_folder_id" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              JSON du compte de service Google
            </label>
            <textarea
              name="service_account_json"
              rows={3}
              placeholder='{"type": "service_account", ...}'
              className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs"
            />
          </div>
        </div>
      )}

      {(type === "nas" || type === "local_server") && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">URL WebDAV</label>
            <input
              name="url"
              placeholder="https://nas.exemple.com/webdav"
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Identifiant</label>
              <input name="username" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Mot de passe</label>
              <input name="password" type="password" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Dossier de base (optionnel)</label>
              <input name="base_path" placeholder="/seritex" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
            </div>
          </div>
        </div>
      )}

      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Créer la cible
      </Button>
    </form>
  );
}
