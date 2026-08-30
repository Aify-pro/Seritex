"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateSageConnectionConfig, toggleSageConnectionActive } from "./actions";
import type { SageConnectionConfig } from "@/lib/types/domain";

export function SageConfigForm({ config }: { config: SageConnectionConfig }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateSageConnectionConfig(formData);
          if (res.error) toast.error(res.error);
          else toast.success("Paramètres de connexion Sage enregistrés");
        })
      }
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={config.id} />
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Libellé</label>
        <input name="label" required defaultValue={config.label} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Mode</label>
        <select name="sync_mode" defaultValue={config.sync_mode} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm">
          <option value="simulation">Simulation (démonstration)</option>
          <option value="agent_local">Agent local (application de synchro Sage)</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Hôte du serveur Sage</label>
        <input
          name="host"
          placeholder="ex. sage-srv.local"
          defaultValue={config.host ?? ""}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Port</label>
        <input
          name="port"
          type="number"
          defaultValue={config.port ?? ""}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Base de données</label>
        <input
          name="database_name"
          defaultValue={config.database_name ?? ""}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Fréquence de synchro (minutes)</label>
        <input
          name="sync_frequency_minutes"
          type="number"
          defaultValue={config.sync_frequency_minutes}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Schéma Stock</label>
        <input
          name="schema_stock"
          defaultValue={config.schema_stock ?? ""}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Schéma Clients</label>
        <input
          name="schema_clients"
          defaultValue={config.schema_clients ?? ""}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Schéma Articles</label>
        <input
          name="schema_articles"
          defaultValue={config.schema_articles ?? ""}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
      </div>

      <div className="flex items-end gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await toggleSageConnectionActive(config.id, !config.active);
              if (res.error) toast.error(res.error);
            })
          }
        >
          {config.active ? "Désactiver la connexion" : "Activer la connexion"}
        </Button>
      </div>
    </form>
  );
}
